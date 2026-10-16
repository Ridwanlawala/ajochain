import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider, formatUnits, parseUnits, isAddress, MaxUint256 } from "ethers";
import abi from "./abi.json";
import deployed from "./deployments.json";
import { PORTALDOT, switchToPortaldot } from "./chain.js";

const STATUS = ["Open", "Active", "Completed"];
const DECIMALS = 6;
const fmt = (v) => Number(formatUnits(v, DECIMALS)).toLocaleString(undefined, { maximumFractionDigits: 2 });
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const LS_KEY = "ajochain.addresses";

function loadAddresses() {
  const saved = JSON.parse(localStorage.getItem(LS_KEY) || "null");
  if (saved?.AjoChain && saved?.MockNaira) return { ...saved, source: "custom" };
  if (deployed.AjoChain && deployed.MockNaira) return { AjoChain: deployed.AjoChain, MockNaira: deployed.MockNaira, source: "deployed" };
  return null;
}

function friendlyError(e) {
  const msg = e?.shortMessage || e?.reason || e?.info?.error?.message || e?.message || String(e);
  return msg.replace(/\(action=.*$/, "").slice(0, 220);
}

export default function App() {
  const [addresses, setAddresses] = useState(loadAddresses);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [signer, setSigner] = useState(null);
  const [balance, setBalance] = useState(null);
  const [score, setScore] = useState(null);
  const [rep, setRep] = useState(null);
  const [circles, setCircles] = useState([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const [rpcOk, setRpcOk] = useState(null);

  const readProvider = useMemo(() => {
    if (window.ethereum && chainId === PORTALDOT.chainId) return new BrowserProvider(window.ethereum);
    return new JsonRpcProvider(PORTALDOT.rpcUrl, PORTALDOT.chainId, { staticNetwork: true });
  }, [chainId]);

  const contracts = useMemo(() => {
    if (!addresses) return null;
    const runner = signer || readProvider;
    return {
      ajo: new Contract(addresses.AjoChain, abi.AjoChain, runner),
      token: new Contract(addresses.MockNaira, abi.MockNaira, runner),
    };
  }, [addresses, signer, readProvider]);

  // ---------------------------------------------------------------- wallet
  const connect = async () => {
    if (!window.ethereum) {
      setNotice({ kind: "error", text: "No injected wallet found. Install MetaMask (or any EIP-1193 wallet) and reload." });
      return;
    }
    try {
      const provider = new BrowserProvider(window.ethereum);
      const [acc] = await provider.send("eth_requestAccounts", []);
      setAccount(acc);
      setChainId(Number((await provider.getNetwork()).chainId));
      setSigner(await provider.getSigner());
    } catch (e) {
      setNotice({ kind: "error", text: friendlyError(e) });
    }
  };

  useEffect(() => {
    if (!window.ethereum) return;
    const onAccounts = (accs) => {
      setAccount(accs[0] || null);
      if (!accs[0]) setSigner(null);
      else new BrowserProvider(window.ethereum).getSigner().then(setSigner);
    };
    const onChain = (hex) => {
      setChainId(parseInt(hex, 16));
      if (account) new BrowserProvider(window.ethereum).getSigner().then(setSigner);
    };
    window.ethereum.on?.("accountsChanged", onAccounts);
    window.ethereum.on?.("chainChanged", onChain);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onAccounts);
      window.ethereum.removeListener?.("chainChanged", onChain);
    };
  }, [account]);

  // ---------------------------------------------------------------- data
  const refresh = useCallback(async () => {
    try {
      await readProvider.getBlockNumber();
      setRpcOk(true);
    } catch {
      setRpcOk(false);
      return;
    }
    if (!contracts) return;
    try {
      const n = Number(await contracts.ajo.circleCount());
      const list = [];
      for (let i = n - 1; i >= 0 && list.length < 25; i--) {
        const c = await contracts.ajo.getCircle(i);
        const members = await contracts.ajo.getMembers(i);
        const round = Number(c.currentRound);
        const paid = await Promise.all(members.map((m) => contracts.ajo.hasPaid(i, round, m)));
        const late = await Promise.all(members.map((m) => contracts.ajo.paidLate(i, round, m)));
        list.push({ id: i, ...c.toObject(), status: Number(c.status), members, paid, late });
      }
      setCircles(list);
      if (account) {
        setBalance(await contracts.token.balanceOf(account));
        setScore(await contracts.ajo.reputationScore(account));
        setRep((await contracts.ajo.reputationOf(account)).toObject());
      }
    } catch (e) {
      setNotice({ kind: "error", text: `Could not read contracts: ${friendlyError(e)}` });
    }
  }, [contracts, account, readProvider]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const send = async (label, fn) => {
    if (!signer) return setNotice({ kind: "error", text: "Connect your wallet first." });
    if (chainId !== PORTALDOT.chainId) return setNotice({ kind: "error", text: "Switch to PortaldotV3 Testnet first." });
    setBusy(label);
    setNotice(null);
    try {
      const tx = await fn();
      setNotice({ kind: "info", text: `${label}: sent ${short(tx.hash)}, waiting for inclusion…` });
      await tx.wait();
      setNotice({ kind: "ok", text: `${label}: confirmed in tx ${tx.hash}` });
      await refresh();
    } catch (e) {
      setNotice({ kind: "error", text: `${label} failed: ${friendlyError(e)}` });
    } finally {
      setBusy("");
    }
  };

  const ensureAllowance = async (amount) => {
    const allowance = await contracts.token.allowance(account, addresses.AjoChain);
    if (allowance < amount) {
      const tx = await contracts.token.approve(addresses.AjoChain, MaxUint256);
      setNotice({ kind: "info", text: `Approving tNGN… ${short(tx.hash)}` });
      await tx.wait();
    }
  };

  // ---------------------------------------------------------------- forms
  const [form, setForm] = useState({ name: "Friday market ajo", amount: "5000", members: "4", days: "7", minRep: "0" });
  const createCircle = (e) => {
    e.preventDefault();
    send("Create circle", () =>
      contracts.ajo.createCircle(
        form.name.trim(),
        addresses.MockNaira,
        parseUnits(form.amount || "0", DECIMALS),
        Number(form.members),
        BigInt(Math.round(Number(form.days) * 86400)),
        Number(form.minRep)
      )
    );
  };

  const [custom, setCustom] = useState({ AjoChain: "", MockNaira: "" });
  const saveCustom = (e) => {
    e.preventDefault();
    if (!isAddress(custom.AjoChain) || !isAddress(custom.MockNaira)) return setNotice({ kind: "error", text: "Both addresses must be valid 0x addresses." });
    localStorage.setItem(LS_KEY, JSON.stringify(custom));
    setAddresses({ ...custom, source: "custom" });
  };

  const wrongChain = account && chainId !== PORTALDOT.chainId;
  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>
            <span className="logo">⭕</span> AjoChain
          </h1>
          <p className="tag">Rotating savings circles (ajo · esusu · adashi) with on-chain records and a portable savings reputation, on Portaldot V3 EVM.</p>
        </div>
        <div className="wallet">
          {account ? (
            <>
              <span className="pill">{short(account)}</span>
              {wrongChain ? (
                <button onClick={() => switchToPortaldot(window.ethereum).catch((e) => setNotice({ kind: "error", text: friendlyError(e) }))}>Switch to Portaldot</button>
              ) : (
                <span className="pill ok">PortaldotV3 Testnet</span>
              )}
            </>
          ) : (
            <button onClick={connect}>Connect wallet</button>
          )}
        </div>
      </header>

      {rpcOk === false && (
        <div className="banner warn">
          The Portaldot V3 testnet RPC (<code>{PORTALDOT.rpcUrl}</code>) is not reachable right now. Reads and writes resume as soon as it is back.
        </div>
      )}
      {notice && <div className={`banner ${notice.kind}`}>{notice.text}</div>}

      {!addresses ? (
        <section className="card">
          <h2>Contracts not deployed yet</h2>
          <p>
            This build has no Portaldot testnet addresses baked in yet. Deploy with <code>npm run deploy:portaldot</code> (see README), or paste the addresses of an
            existing deployment:
          </p>
          <form onSubmit={saveCustom} className="grid2">
            <label>
              AjoChain address
              <input value={custom.AjoChain} onChange={(e) => setCustom({ ...custom, AjoChain: e.target.value.trim() })} placeholder="0x…" />
            </label>
            <label>
              MockNaira (tNGN) address
              <input value={custom.MockNaira} onChange={(e) => setCustom({ ...custom, MockNaira: e.target.value.trim() })} placeholder="0x…" />
            </label>
            <button type="submit">Use these contracts</button>
          </form>
        </section>
      ) : (
        <>
          <section className="stats">
            <div className="card stat">
              <span>Your tNGN</span>
              <b>{balance === null ? "—" : fmt(balance)}</b>
              <button disabled={!!busy} onClick={() => send("Faucet", () => contracts.token.faucet())}>
                Get 100,000 test tNGN
              </button>
            </div>
            <div className="card stat">
              <span>Savings reputation</span>
              <b className={score !== null && score < 0n ? "neg" : ""}>{score === null ? "—" : score.toString()}</b>
              {rep && (
                <small>
                  {rep.onTime.toString()} on time · {rep.late.toString()} late · {rep.defaults.toString()} defaults · {rep.circlesCompleted.toString()} circles done
                </small>
              )}
            </div>
            <div className="card stat">
              <span>Contracts ({addresses.source})</span>
              <small>
                AjoChain <code>{short(addresses.AjoChain)}</code>
                <br />
                tNGN <code>{short(addresses.MockNaira)}</code>
              </small>
              {addresses.source === "custom" && (
                <button
                  className="ghost"
                  onClick={() => {
                    localStorage.removeItem(LS_KEY);
                    setAddresses(loadAddresses());
                  }}
                >
                  Reset
                </button>
              )}
            </div>
          </section>

          <section className="card">
            <h2>Start a circle</h2>
            <form onSubmit={createCircle} className="grid5">
              <label>
                Name
                <input maxLength={64} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>
                Contribution (tNGN / round)
                <input type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </label>
              <label>
                Members
                <input type="number" min="2" max="50" value={form.members} onChange={(e) => setForm({ ...form, members: e.target.value })} />
              </label>
              <label>
                Round length (days)
                <input type="number" min="0.001" step="any" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
              </label>
              <label>
                Min. reputation to join
                <input type="number" value={form.minRep} onChange={(e) => setForm({ ...form, minRep: e.target.value })} />
              </label>
              <button type="submit" disabled={!!busy}>
                Create &amp; join as member #1
              </button>
            </form>
          </section>

          <section>
            <div className="row">
              <h2>Circles</h2>
              <button className="ghost" onClick={refresh}>
                Refresh
              </button>
            </div>
            {circles.length === 0 && <p className="muted">No circles yet. Start the first one above.</p>}
            {circles.map((c) => {
              const me = account && c.members.some((m) => m.toLowerCase() === account.toLowerCase());
              const myIdx = me ? c.members.findIndex((m) => m.toLowerCase() === account.toLowerCase()) : -1;
              const deadline = Number(c.roundStart) + Number(c.roundDuration);
              const overdue = c.status === 1 && now > deadline;
              const allPaid = c.paid.length > 0 && c.paid.every(Boolean);
              return (
                <article key={c.id} className="card circle">
                  <div className="row">
                    <h3>
                      #{c.id} {c.name}
                    </h3>
                    <span className={`pill s${c.status}`}>{STATUS[c.status]}</span>
                  </div>
                  <p className="muted">
                    {fmt(c.contribution)} tNGN per member per round · {c.memberCount.toString()}/{c.maxMembers.toString()} members · pot {fmt(c.contribution * c.maxMembers)} tNGN ·
                    round length {(Number(c.roundDuration) / 86400).toLocaleString()} days · min reputation {c.minReputation.toString()}
                  </p>
                  {c.status === 1 && (
                    <p>
                      Round {Number(c.currentRound) + 1} of {c.memberCount.toString()} · pays out to <b>{short(c.members[Number(c.currentRound)])}</b> · deadline{" "}
                      {new Date(deadline * 1000).toLocaleString()} {overdue && <span className="pill s-late">overdue</span>}
                    </p>
                  )}
                  <ol className="members">
                    {c.members.map((m, i) => (
                      <li key={m} className={c.status === 1 && i === Number(c.currentRound) ? "recipient" : ""}>
                        <code>{short(m)}</code>
                        {c.status === 1 && (c.paid[i] ? <span className={`pill ${c.late[i] ? "s-late" : "ok"}`}>{c.late[i] ? "paid late" : "paid"}</span> : <span className="pill">unpaid</span>)}
                        {c.status === 1 && overdue && !c.paid[i] && (
                          <button className="ghost small" disabled={!!busy} onClick={() => send("Flag default", () => contracts.ajo.flagDefault(c.id, m))}>
                            flag default
                          </button>
                        )}
                        {c.status === 1 && i < Number(c.currentRound) && <span className="muted"> received</span>}
                        {c.status === 2 && <span className="muted"> received</span>}
                      </li>
                    ))}
                  </ol>
                  <div className="actions">
                    {c.status === 0 && !me && (
                      <button disabled={!!busy} onClick={() => send("Join circle", () => contracts.ajo.joinCircle(c.id))}>
                        Join circle
                      </button>
                    )}
                    {c.status === 1 && me && !c.paid[myIdx] && (
                      <button
                        disabled={!!busy}
                        onClick={() =>
                          send("Contribute", async () => {
                            await ensureAllowance(c.contribution);
                            return contracts.ajo.contribute(c.id);
                          })
                        }
                      >
                        Pay {fmt(c.contribution)} tNGN{overdue ? " (late)" : ""}
                      </button>
                    )}
                    {c.status === 1 && allPaid && (
                      <button disabled={!!busy} onClick={() => send("Release payout", () => contracts.ajo.releasePayout(c.id))}>
                        Release pot to {short(c.members[Number(c.currentRound)])}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        </>
      )}

      <section className="card how">
        <h2>How it works</h2>
        <ol>
          <li>Someone starts a circle: contribution, number of members, round length, and an optional minimum reputation.</li>
          <li>Members join. When the last seat fills, round 1 starts. The payout order is the join order.</li>
          <li>Each round every member pays the fixed amount. Paying after the deadline is accepted but recorded as late.</li>
          <li>When everyone has paid, anyone can release the pot to that round's member. No organiser holds the money.</li>
          <li>Reputation follows your address across circles: +10 on time, −5 late, −30 flagged default, +25 per completed circle.</li>
        </ol>
        <p className="muted">
          Testnet only. tNGN is a valueless test token with a public faucet. Network: {PORTALDOT.chainName}, chain id {PORTALDOT.chainId}. Gas token tPOTv3: fund your wallet's
          mapped address via the Portaldot node console (see README).
        </p>
      </section>

      <footer>
        Built by Lawal Ridwan for Portaldot Hacker House 2026 · <a href="https://github.com/Ridwanlawala/ajochain">source on GitHub</a> · MIT
      </footer>
      {busy && <div className="busy">{busy}…</div>}
    </div>
  );
}
