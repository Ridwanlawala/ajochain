// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockNaira (tNGN) — test stablecoin for the AjoChain demo
/// @notice Valueless testnet token with a public, rate-limited faucet so anyone can try AjoChain
///         on the Portaldot V3 testnet without real money.
contract MockNaira is ERC20 {
    uint8 private constant DECIMALS = 6;
    uint256 public constant FAUCET_AMOUNT = 100_000 * 10 ** DECIMALS; // 100,000 tNGN
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    mapping(address => uint256) public lastClaim;

    event FaucetClaimed(address indexed to, uint256 amount);

    error FaucetCooldown(uint256 availableAt);

    constructor() ERC20("Mock Naira Stablecoin", "tNGN") {}

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /// @notice Mint FAUCET_AMOUNT to the caller, at most once per FAUCET_COOLDOWN.
    function faucet() external {
        uint256 last = lastClaim[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldown(last + FAUCET_COOLDOWN);
        }
        lastClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }
}
