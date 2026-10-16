// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AjoChain — on-chain rotating savings circles (ajo / esusu / ROSCA)
/// @author Lawal Ridwan
/// @notice A group of members each pay a fixed ERC-20 contribution every round; each round the whole
///         pot goes to one member, rotating in join order until everyone has been paid once.
///         Every contribution is recorded on-chain with an on-time / late flag, and each address
///         carries a portable reputation score across circles.
contract AjoChain is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        Open, // gathering members
        Active, // rounds running
        Completed // everyone has received one payout
    }

    struct Circle {
        string name;
        address creator;
        IERC20 token;
        uint256 contribution; // per member, per round
        uint64 roundDuration; // seconds a round lasts before a contribution counts as late
        uint64 roundStart; // timestamp the current round opened
        uint32 maxMembers;
        uint32 currentRound; // 0-based index of the round in progress
        int32 minReputation; // members below this score cannot join
        Status status;
        address[] members; // payout order == join order
    }

    struct Reputation {
        uint32 onTime;
        uint32 late;
        uint32 defaults;
        uint32 circlesCompleted;
    }

    // ---- scoring weights (public so the UI can explain the score) ----
    int256 public constant ON_TIME_POINTS = 10;
    int256 public constant LATE_PENALTY = 5;
    int256 public constant DEFAULT_PENALTY = 30;
    int256 public constant COMPLETION_BONUS = 25;

    uint32 public constant MIN_MEMBERS = 2;
    uint32 public constant MAX_MEMBERS = 50;

    Circle[] private _circles;

    /// circleId => round => member => paid
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public hasPaid;
    /// circleId => round => member => paid late
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public paidLate;
    /// circleId => round => member => default already flagged
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public defaultFlagged;
    /// circleId => round => number of contributions received
    mapping(uint256 => mapping(uint256 => uint256)) public paidCount;
    /// circleId => member => is member
    mapping(uint256 => mapping(address => bool)) public isMember;

    mapping(address => Reputation) public reputationOf;

    event CircleCreated(
        uint256 indexed circleId,
        address indexed creator,
        address token,
        uint256 contribution,
        uint32 maxMembers,
        uint64 roundDuration,
        string name
    );
    event MemberJoined(uint256 indexed circleId, address indexed member, uint256 position);
    event CircleStarted(uint256 indexed circleId, uint64 startedAt);
    event ContributionMade(
        uint256 indexed circleId, uint256 indexed round, address indexed member, uint256 amount, bool late
    );
    event LateFlagged(uint256 indexed circleId, uint256 indexed round, address indexed member);
    event DefaultFlagged(uint256 indexed circleId, uint256 indexed round, address indexed member, address reporter);
    event PayoutSent(uint256 indexed circleId, uint256 indexed round, address indexed recipient, uint256 amount);
    event CircleCompleted(uint256 indexed circleId);

    error InvalidParams();
    error UnknownCircle();
    error NotOpen();
    error NotActive();
    error AlreadyMember();
    error NotMember();
    error CircleFull();
    error ReputationTooLow(int256 score, int256 required);
    error AlreadyPaid();
    error RoundIncomplete(uint256 paid, uint256 needed);
    error RoundNotOverdue();
    error AlreadyFlagged();

    modifier exists(uint256 circleId) {
        if (circleId >= _circles.length) revert UnknownCircle();
        _;
    }

    // ------------------------------------------------------------------ write

    /// @notice Create a circle and join it as member #1 (first payout goes to the creator).
    function createCircle(
        string calldata name,
        address token,
        uint256 contribution,
        uint32 maxMembers,
        uint64 roundDuration,
        int32 minReputation
    ) external returns (uint256 circleId) {
        if (
            token == address(0) || contribution == 0 || maxMembers < MIN_MEMBERS || maxMembers > MAX_MEMBERS
                || roundDuration == 0 || bytes(name).length == 0 || bytes(name).length > 64
        ) revert InvalidParams();

        circleId = _circles.length;
        Circle storage c = _circles.push();
        c.name = name;
        c.creator = msg.sender;
        c.token = IERC20(token);
        c.contribution = contribution;
        c.maxMembers = maxMembers;
        c.roundDuration = roundDuration;
        c.minReputation = minReputation;
        c.status = Status.Open;

        emit CircleCreated(circleId, msg.sender, token, contribution, maxMembers, roundDuration, name);
        _join(circleId, c, msg.sender);
    }

    /// @notice Join an open circle. The circle starts automatically when the last seat is filled.
    function joinCircle(uint256 circleId) external exists(circleId) {
        Circle storage c = _circles[circleId];
        if (c.status != Status.Open) revert NotOpen();
        int256 score = reputationScore(msg.sender);
        if (score < int256(c.minReputation)) revert ReputationTooLow(score, int256(c.minReputation));
        _join(circleId, c, msg.sender);
    }

    /// @notice Pay this round's contribution. Requires a prior ERC-20 approve to this contract.
    ///         Paying after roundStart + roundDuration is accepted but recorded as late.
    function contribute(uint256 circleId) external nonReentrant exists(circleId) {
        Circle storage c = _circles[circleId];
        if (c.status != Status.Active) revert NotActive();
        if (!isMember[circleId][msg.sender]) revert NotMember();
        uint256 round = c.currentRound;
        if (hasPaid[circleId][round][msg.sender]) revert AlreadyPaid();

        bool late = block.timestamp > uint256(c.roundStart) + c.roundDuration;
        hasPaid[circleId][round][msg.sender] = true;
        paidCount[circleId][round] += 1;

        Reputation storage r = reputationOf[msg.sender];
        if (late) {
            paidLate[circleId][round][msg.sender] = true;
            r.late += 1;
            emit LateFlagged(circleId, round, msg.sender);
        } else {
            r.onTime += 1;
        }

        c.token.safeTransferFrom(msg.sender, address(this), c.contribution);
        emit ContributionMade(circleId, round, msg.sender, c.contribution, late);
    }

    /// @notice Once every member has paid, send the pot to this round's recipient and open the next round.
    ///         Anyone can call it, so the circle never depends on one organiser.
    function releasePayout(uint256 circleId) external nonReentrant exists(circleId) {
        Circle storage c = _circles[circleId];
        if (c.status != Status.Active) revert NotActive();
        uint256 round = c.currentRound;
        uint256 n = c.members.length;
        uint256 paid = paidCount[circleId][round];
        if (paid < n) revert RoundIncomplete(paid, n);

        address recipient = c.members[round];
        uint256 pot = c.contribution * n;

        if (round + 1 == n) {
            c.status = Status.Completed;
            for (uint256 i = 0; i < n; i++) {
                reputationOf[c.members[i]].circlesCompleted += 1;
            }
        } else {
            c.currentRound = uint32(round + 1);
            c.roundStart = uint64(block.timestamp);
        }

        c.token.safeTransfer(recipient, pot);
        emit PayoutSent(circleId, round, recipient, pot);
        if (c.status == Status.Completed) emit CircleCompleted(circleId);
    }

    /// @notice Flag a member who still has not paid after the round deadline. Costs the defaulter
    ///         DEFAULT_PENALTY reputation once per round; paying later still counts (as late).
    function flagDefault(uint256 circleId, address member) external exists(circleId) {
        Circle storage c = _circles[circleId];
        if (c.status != Status.Active) revert NotActive();
        if (!isMember[circleId][member]) revert NotMember();
        uint256 round = c.currentRound;
        if (hasPaid[circleId][round][member]) revert AlreadyPaid();
        if (block.timestamp <= uint256(c.roundStart) + c.roundDuration) revert RoundNotOverdue();
        if (defaultFlagged[circleId][round][member]) revert AlreadyFlagged();

        defaultFlagged[circleId][round][member] = true;
        reputationOf[member].defaults += 1;
        emit DefaultFlagged(circleId, round, member, msg.sender);
    }

    // ------------------------------------------------------------------- read

    function circleCount() external view returns (uint256) {
        return _circles.length;
    }

    /// @notice Flat, ABI-friendly snapshot of a circle (members via getMembers).
    struct CircleView {
        uint256 id;
        string name;
        address creator;
        address token;
        uint256 contribution;
        uint32 maxMembers;
        uint64 roundDuration;
        uint64 roundStart;
        uint32 currentRound;
        int32 minReputation;
        Status status;
        uint256 memberCount;
    }

    function getCircle(uint256 circleId) external view exists(circleId) returns (CircleView memory v) {
        Circle storage c = _circles[circleId];
        v.id = circleId;
        v.name = c.name;
        v.creator = c.creator;
        v.token = address(c.token);
        v.contribution = c.contribution;
        v.maxMembers = c.maxMembers;
        v.roundDuration = c.roundDuration;
        v.roundStart = c.roundStart;
        v.currentRound = c.currentRound;
        v.minReputation = c.minReputation;
        v.status = c.status;
        v.memberCount = c.members.length;
    }

    function getMembers(uint256 circleId) external view exists(circleId) returns (address[] memory) {
        return _circles[circleId].members;
    }

    /// @notice Member receiving the pot in the current round (address(0) unless Active).
    function currentRecipient(uint256 circleId) external view exists(circleId) returns (address) {
        Circle storage c = _circles[circleId];
        if (c.status != Status.Active) return address(0);
        return c.members[c.currentRound];
    }

    /// @notice Unix time after which a contribution for the current round is late.
    function roundDeadline(uint256 circleId) external view exists(circleId) returns (uint256) {
        Circle storage c = _circles[circleId];
        if (c.status != Status.Active) return 0;
        return uint256(c.roundStart) + c.roundDuration;
    }

    /// @notice Portable credit-style score: +10 per on-time payment, -5 per late payment,
    ///         -30 per flagged default, +25 per completed circle. New users start at 0.
    function reputationScore(address account) public view returns (int256) {
        Reputation memory r = reputationOf[account];
        return int256(uint256(r.onTime)) * ON_TIME_POINTS - int256(uint256(r.late)) * LATE_PENALTY
            - int256(uint256(r.defaults)) * DEFAULT_PENALTY + int256(uint256(r.circlesCompleted)) * COMPLETION_BONUS;
    }

    // --------------------------------------------------------------- internal

    function _join(uint256 circleId, Circle storage c, address who) private {
        if (isMember[circleId][who]) revert AlreadyMember();
        if (c.members.length >= c.maxMembers) revert CircleFull();
        isMember[circleId][who] = true;
        c.members.push(who);
        emit MemberJoined(circleId, who, c.members.length - 1);

        if (c.members.length == c.maxMembers) {
            c.status = Status.Active;
            c.roundStart = uint64(block.timestamp);
            emit CircleStarted(circleId, c.roundStart);
        }
    }
}
