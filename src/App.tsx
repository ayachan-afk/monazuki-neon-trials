import { useEffect, useMemo, useRef, useState } from "react";
import { PrivyProvider, usePrivy, useCrossAppAccounts } from "@privy-io/react-auth";
import { BrowserProvider, Contract, parseEther } from "ethers";

/** ====== ENV ====== */
const APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string;
const MGID_PROVIDER_APP_ID = import.meta.env.VITE_MGID_CROSS_APP_ID as string;
const CHAIN_ID_NUM = Number(import.meta.env.VITE_CHAIN_ID || "10143");
const CHAIN_ID_HEX = "0x" + CHAIN_ID_NUM.toString(16);
const MONAD_RPC = import.meta.env.VITE_MONAD_RPC as string;
const ALCHEMY_BASE = import.meta.env.VITE_ALCHEMY_BASE as string;
const GAME_ADDR = import.meta.env.VITE_GAME_ADDR as `0x${string}`;
const OE_ADDR = import.meta.env.VITE_OE_ADDR as `0x${string}`;
const MGID_LEADERBOARD_URL = "https://monad-games-id-site.vercel.app/leaderboard";
const MARKET_URL = "https://magiceden.io/collections/monad-testnet/0x6611001bcac4936d000b2b29054640cf16c3d2a1";

/** ====== ABIs (minimal) ====== */
const GAME_ABI = [
  // views
  "function player(address) view returns (uint256 atScene,bool started,bool finished,uint256 localScore,uint256 localTxCount,uint256 moves,uint256 lastMoveAt,uint256 lastLossAt)",
  "function getScene(uint256 id) view returns (bool exists,bool isEnding,bool victory,uint32 scoreDelta,string text,uint256[] next)",
  "function moveCooldownSeconds() view returns (uint256)",
  "function RESTART_COOLDOWN_AFTER_LOSS() view returns (uint256)",
  "function badge() view returns (address)",
  "function winnersTotal() view returns (uint256)",
  "function isWinner(address) view returns (bool)",
  "function personalToMGID(address) view returns (address)",

  // gameplay
  "function startWithFuel721(uint256 tokenId) external",
  "function choose(uint256 optionIndex) external",

  // side actions
  "function logStep(uint256 sceneId) external",
  "function restAt(uint256 sceneId) external",
  "function inspectObject(uint256 sceneId) external",
  "function offerAtShrine(uint256 sceneId) external payable",

  // mgid link on-chain
  "function linkMyMGID(address mgid) external",

  // leaderboard manual sync
  "function syncPlayer(address addr) external",
] as const;

const OE_ABI = [
  "function isApprovedForAll(address owner,address operator) view returns (bool)",
  "function setApprovalForAll(address operator,bool approved)"
] as const;

const BADGE_ABI = [
  "function balanceOf(address account, uint256 id) view returns (uint256)"
] as const;

/** ====== Helpers ====== */
const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "-");
const nowSec = () => Math.floor(Date.now() / 1000);
const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m ${sec}s`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
};
function pickMGID(linkedAccounts: any[], providerId: string): string | undefined {
  if (!Array.isArray(linkedAccounts)) return;
  let acct = linkedAccounts.find((a: any) => a?.type === "cross_app" && a?.providerApp?.id === providerId);
  if (!acct) acct = linkedAccounts.find((a: any) => a?.type === "cross_app");
  if (!acct) return;
  return acct?.embeddedWallets?.[0]?.address || acct?.wallets?.[0]?.address || acct?.address;
}

function getSceneDescription(sceneId: number): string {
  const sceneDescriptions: {[key: number]: string} = {
    41: "Neon Dock — slip past scanners",
    42: "Back-alley Relay — side door",
    43: "Subnet Gate — time your step",
    44: "Ambushed by Nullers",
    45: "Overpass Scanner — drone's eye",
    46: "Core Uplink — follow Zuki's whisper",
    47: "Dead Channel",
    48: "Monad Beacon — final handoff",
    49: "Trace Overload",
    50: "Zuki's Neon Crown",
    51: "Neon Market — follow the courier",
    52: "Whisper in the Grid",
    53: "Narrow Alley — service bridge",
    54: "Wind Checkpoint",
    55: "Bypass Checkpoint — footprint deepens",
    56: "Maintenance Tunnel — city's heart",
    57: "Silent Lift — fractured skyline",
    58: "Private Deck — converging routes",
    59: "Security Sweep — luminous leap",
    60: "Neon Dawn — signal escapes"
  };
  
  return sceneDescriptions[sceneId] || `Unknown path #${sceneId}`;
}

function getSceneName(sceneId: number): string {
  const sceneNames: {[key: number]: string} = {
    41: "Neon Dock",
    42: "Back-alley Relay",
    43: "Subnet Gate",
    44: "Nuller Ambush",
    45: "Overpass Scanner",
    46: "Core Uplink",
    47: "Dead Channel",
    48: "Monad Beacon",
    49: "Trace Overload",
    50: "Zuki's Neon Crown",
    51: "Neon Market",
    52: "Whisper in the Grid",
    53: "Narrow Alley",
    54: "Wind Checkpoint",
    55: "Bypass Checkpoint",
    56: "Maintenance Tunnel",
    57: "Silent Lift",
    58: "Private Deck",
    59: "Security Sweep",
    60: "Neon Dawn"
  };
  
  return sceneNames[sceneId] || `Scene ${sceneId}`;
}

/** ===================== INNER UI ===================== */
function UI() {
  // Personal wallet (MetaMask)
  const [personalAddr, setPersonalAddr] = useState<string>("");

  // Contracts
  const [game, setGame] = useState<Contract | null>(null);
  const [badge, setBadge] = useState<Contract | null>(null);
  const [oe, setOE] = useState<Contract | null>(null);

  // Player state
  const [status, setStatus] = useState<string>("The neon hum whispers. Ready?");
  const [moveCD, setMoveCD] = useState<number>(5);
  const [restartCD, setRestartCD] = useState<number>(3600);

  const [p_atScene, setP_atScene] = useState<number>(0);
  const [p_started, setP_started] = useState<boolean>(false);
  const [p_finished, setP_finished] = useState<boolean>(false);
  const [p_localScore, setP_localScore] = useState<number>(0);
  const [p_lastMoveAt, setP_lastMoveAt] = useState<number>(0);
  const [p_lastLossAt, setP_lastLossAt] = useState<number>(0);

  const [sceneText, setSceneText] = useState<string>("");
  const [sceneNext, setSceneNext] = useState<number[]>([]);
  const [sceneOptions, setSceneOptions] = useState<string[]>([]);
  const [sceneIsEnding, setSceneIsEnding] = useState<boolean>(false);
  const [sceneVictory, setSceneVictory] = useState<boolean>(false);

  // NFT (cached)
  const [tokenIds, setTokenIds] = useState<number[]>([]);
  const [, setNftsLoaded] = useState<boolean>(false);
  const [, setOwnerAtFetch] = useState<string>("");
  const [loadingNFTs, setLoadingNFTs] = useState<boolean>(false);

  // Badge & leaderboard
  const [badgeOwned, setBadgeOwned] = useState<boolean>(false);
  const [winnersTotal, setWinnersTotal] = useState<number>(0);

  // Shrine
  const [shrineValue, setShrineValue] = useState<string>("0.01");

  // Timers
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    tickRef.current = window.setInterval(() => setNowMs(Date.now()), 1000) as unknown as number;
    return () => { if (tickRef.current) window.clearInterval(tickRef.current); };
  }, []);

  const canMoveAtMs = useMemo(() => (p_lastMoveAt ? (p_lastMoveAt + moveCD) * 1000 : 0), [p_lastMoveAt, moveCD]);
  const canRestartAtMs = useMemo(() => (p_lastLossAt ? (p_lastLossAt + restartCD) * 1000 : 0), [p_lastLossAt, restartCD]);

  /** ===== Privy (MGID) ===== */
  const { ready, authenticated, user, login } = usePrivy();
  const { loginWithCrossAppAccount } = useCrossAppAccounts();
  const [mgidAddr, setMgidAddr] = useState<string>("");
  const [mgidUsername, setMgidUsername] = useState<string>("");
  const [linking, setLinking] = useState<boolean>(false);

  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    const mg = pickMGID(user.linkedAccounts ?? [], MGID_PROVIDER_APP_ID);
    setMgidAddr(mg || "");
    if (mg) {
      fetch(`https://monad-games-id-site.vercel.app/api/check-wallet?wallet=${mg}`)
        .then(r => r.ok ? r.json() : null)
        .then(j => {
          if (j?.hasUsername && j.user?.username) setMgidUsername(j.user.username);
        })
        .catch(() => {});
    }
  }, [ready, authenticated, user]);

  function refreshMGIDFromHook() {
    if (!user) return;
    const mg = pickMGID(user.linkedAccounts ?? [], MGID_PROVIDER_APP_ID);
    setMgidAddr(mg || "");
    if (mg) {
      fetch(`https://monad-games-id-site.vercel.app/api/check-wallet?wallet=${mg}`)
        .then(r => r.ok ? r.json() : null)
        .then(j => {
          if (j?.hasUsername && j.user?.username) setMgidUsername(j.user.username);
        })
        .catch(() => {});
    }
  }

  // Mobile-friendly
  async function linkMGIDPrivyFlow() {
    if (linking) return;
    setLinking(true);
    try {
      if (!ready) { setStatus("Privy is initializing. Try again in a moment."); return; }

      if (!authenticated) {
        await login();
        await new Promise((r) => setTimeout(r, 350));
        await new Promise((r) => setTimeout(r, 350));
      }

      await loginWithCrossAppAccount({ appId: MGID_PROVIDER_APP_ID });

      refreshMGIDFromHook();
      setStatus("MGID linked via Privy ✓ — bind it on-chain to secure it.");
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (/already logged in/i.test(msg)) {
        refreshMGIDFromHook();
        setStatus("Already authenticated. MGID link refreshed.");
      } else if (msg.includes("does not already have an account")) {
        setStatus("No MGID account yet. Please register on the MGID site, then link again.");
      } else {
        setStatus(`MGID linking failed: ${msg}`);
      }
    } finally {
      setLinking(false);
    }
  }

  async function bindMGIDOnChain() {
    try {
      if (!game) return;
      if (!mgidAddr) { alert("MGID not found. Link via Privy first."); return; }
      const st = await game.player(personalAddr);
      if (!Boolean(st[1])) { alert("Start a run first, then bind."); return; }
      const tx = await game.linkMyMGID(mgidAddr);
      await tx.wait();
      setStatus("Identity sealed on-chain ✓");
    } catch (e: any) {
      setStatus(`On-chain binding failed: ${e?.message || e}`);
    }
  }

  /** ===== Connect wallet (MetaMask) ===== */
  async function connectWallet() {
    try {
      const eth = (window as any).ethereum;
      if (!eth?.request) {
        alert("No wallet detected. Please install a wallet that supports Monad Testnet (e.g., MetaMask).");
        return;
      }
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
      } catch (err: any) {
        if (err?.code === 4902 || /Unrecognized chain ID|not added/i.test(err?.message || "")) {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: CHAIN_ID_HEX,
              chainName: "Monad Testnet",
              rpcUrls: [MONAD_RPC],
              nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
              blockExplorers: ["https://testnet.monadexplorer.com"]
            }]
          });
          await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
        } else throw err;
      }

      const provider = new BrowserProvider(eth, CHAIN_ID_NUM);
      const signer = await provider.getSigner();
      const addr = await signer.getAddress();
      setPersonalAddr(addr);
      setStatus(`Welcome, runner ${short(addr)}.`);

      const _game = new Contract(GAME_ADDR, GAME_ABI, signer);
      setGame(_game);
      const _oe = new Contract(OE_ADDR, OE_ABI, signer);
      setOE(_oe);

      const mc = await _game.moveCooldownSeconds();
      setMoveCD(Number(mc));
      try {
        const rc = await _game.RESTART_COOLDOWN_AFTER_LOSS();
        setRestartCD(Number(rc));
      } catch {}

      try {
        const bAddr = await _game.badge();
        if (bAddr && bAddr !== "0x0000000000000000000000000000000000000000") {
          const _badge = new Contract(bAddr, BADGE_ABI, signer);
          setBadge(_badge);
        }
      } catch {}

      await refreshPlayerAndScene(_game, addr);
      await refreshBadge(_game, addr);
      await refreshWinners(_game);

      // reset nft cache
      setNftsLoaded(false);
      setOwnerAtFetch("");
      setTokenIds([]);
    } catch (e: any) {
      setStatus(`Couldn't enter the city: ${e?.message || e}`);
    }
  }

  /** ===== Refresh helpers ===== */
  async function refreshPlayerAndScene(g?: Contract | null, addr?: string) {
    try {
      const gg = g || game; const who = addr || personalAddr;
      if (!gg || !who) return;
      const st = await gg.player(who);
      const at = Number(st[0]);
      setP_atScene(at);
      setP_started(Boolean(st[1]));
      setP_finished(Boolean(st[2]));
      setP_localScore(Number(st[3]));
      setP_lastMoveAt(Number(st[6]));
      setP_lastLossAt(Number(st[7]));

      if (at) {
        const sc = await gg.getScene(at);
        if (Boolean(sc[0])) {
          setSceneIsEnding(Boolean(sc[1]));
          setSceneVictory(Boolean(sc[2]));
          setSceneText(String(sc[4]));
          const nextList = (sc[5] as bigint[]).map(n => Number(n));
          setSceneNext(nextList);
          
          const options = nextList.map(sceneId => getSceneDescription(sceneId));
          setSceneOptions(options);
        } else {
          setSceneText(""); setSceneNext([]); setSceneOptions([]); setSceneIsEnding(false); setSceneVictory(false);
        }
      } else {
        setSceneText(""); setSceneNext([]); setSceneOptions([]); setSceneIsEnding(false); setSceneVictory(false);
      }
    } catch {}
  }
  
  async function refreshBadge(g?: Contract | null, addr?: string) {
    try {
      const gg = g || game; 
      const who = addr || personalAddr;
      if (!gg || !who) return;
      
      const isWinner = await gg.isWinner(who);
      setBadgeOwned(Boolean(isWinner));
    } catch (e) {
      console.error("Error checking badge:", e);
      try {
        if (!badge) return;
        const who = personalAddr;
        const bal = await badge.balanceOf(who, 1);
        setBadgeOwned((bal as bigint) > 0n);
      } catch {}
    }
  }
  
  async function refreshWinners(g?: Contract | null) {
    try {
      const gg = g || game; if (!gg) return;
      const wt = await gg.winnersTotal();
      setWinnersTotal(Number(wt));
    } catch {}
  }

/** ===== Alchemy NFT fetch ===== */
async function loadOE() {
  if (!personalAddr) { 
    setStatus("Connect your wallet first.");
    return; 
  }
  
  setLoadingNFTs(true);
  try {
    setStatus("Scanning your inventory…");
    const url = `${ALCHEMY_BASE}/getNFTsForOwner?owner=${personalAddr}&contractAddresses[]=${OE_ADDR}&withMetadata=false&pageSize=100`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Alchemy error ${res.status}`);
    const data = await res.json();
    const ids: number[] = data?.ownedNfts?.map((n: any) => parseInt(n.id.tokenId, 16)).filter((n: number) => Number.isFinite(n)) ?? [];
    setTokenIds(ids);
    setStatus(ids.length ? `Found ${ids.length} fuel cores.` : "No OE tokens found in this wallet.");
  } catch (e: any) {
    setStatus(`Couldn't read your inventory: ${e?.message || e}`);
  } finally {
    setLoadingNFTs(false);
  }
}

async function ensureApproval() {
  if (!oe || !game || !personalAddr) return;
  const ok = await oe.isApprovedForAll(personalAddr, GAME_ADDR);
  if (!ok) {
    setStatus("Granting the game access to your NFT…");
    const tx = await oe.setApprovalForAll(GAME_ADDR, true);
    console.log("Approval tx:", tx.hash);
    await tx.wait();
    setStatus("Access granted ✓");
  } else {
    setStatus("Access already granted ✓");
  }
}

async function startGame() {
  try {
    if (!game) return;

    if (!tokenIds.length) {
      alert("No OE tokens found for your wallet. Click 'Load your NFT' first.");
      return;
    }

    const choice = prompt(`Choose a tokenId to burn as fuel:\n${tokenIds.join(", ")}`);
    if (!choice) return;
    const tokenId = Number(choice);
    if (!Number.isFinite(tokenId)) {
      alert("Invalid tokenId");
      return;
    }

    await ensureApproval();

    setStatus("Lighting the core…");
    const tx = await game.startWithFuel721(tokenId);
    await tx.wait();

    setStatus("The neon path opens. Your run has begun.");
    await refreshPlayerAndScene();
    await refreshBadge();
  } catch (e: any) {
    const msg = e?.info?.error?.message || e?.shortMessage || e?.message || String(e);
    setStatus(`The engine coughed. ${msg}`);
  }
}

  /** ===== Choose (index-based) ===== */
  async function chooseMove(optionIndex: number) {
    try {
      if (!game || !personalAddr) return;

      const st = await game.player(personalAddr);
      const at = Number(st[0]);
      const started = Boolean(st[1]);
      const finished = Boolean(st[2]);
      const lastMoveAt = Number(st[6]);
      if (!started) { alert("You haven't started a run yet."); return; }
      if (finished) { alert("This run has ended. Start again with a new OE."); return; }

      const sc = await game.getScene(at);
      if (!Boolean(sc[0])) { alert(`Scene ${at} doesn't exist.`); return; }
      if (Boolean(sc[1])) { alert(Boolean(sc[2]) ? "Already Victory." : "This path has ended."); return; }
      const nextList = (sc[5] as bigint[]).map(n => Number(n));
      if (optionIndex < 0 || optionIndex >= nextList.length) {
        alert(`Invalid choice. Valid indices: 0..${Math.max(0, nextList.length - 1)}.`); return;
      }

      const mc = Number(await game.moveCooldownSeconds());
      const nextAllowed = lastMoveAt + mc;
      if (nowSec() < nextAllowed) {
        const wait = nextAllowed - nowSec();
        alert(`You need a breath. Wait ${wait}s before choosing again.`); return;
      }

      setStatus("You step forward. The city watches…");
      const tx = await game.choose(optionIndex);
      await tx.wait();

      await refreshPlayerAndScene();
      await refreshBadge();
      await refreshWinners();
      setStatus("The neon hum grows louder. You advance.");
    } catch (e: any) {
      const msg = e?.info?.error?.message || e?.shortMessage || e?.message || String(e);
      setStatus(`The city denied your step. ${msg}`);
    }
  }

  /** ===== Side actions ===== */
  async function doTrail() {
    if (!game) return;
    try { const tx = await game.logStep(p_atScene); await tx.wait(); setStatus("Your footprint lingers in neon. (Side action recorded)"); }
    catch (e:any){ setStatus(`logStep failed: ${e?.message || e}`); }
  }
  async function doRest() {
    if (!game) return;
    try { const tx = await game.restAt(p_atScene); await tx.wait(); setStatus("You steady your breath. (Side action recorded)"); }
    catch (e:any){ setStatus(`restAt failed: ${e?.message || e}`); }
  }
  async function doExamine() {
    if (!game) return;
    try { const tx = await game.inspectObject(p_atScene); await tx.wait(); setStatus("You study the signs. (Side action recorded)"); }
    catch (e:any){ setStatus(`inspect failed: ${e?.message || e}`); }
  }
  async function doOffer() {
    if (!game) return;
    try {
      const val = parseEther(shrineValue || "0.01");
      const tx = await game.offerAtShrine(p_atScene, { value: val });
      await tx.wait();
      setStatus("Your small offering fades into neon. (Side action recorded)");
    } catch (e: any) { setStatus(`offer failed: ${e?.message || e}`); }
  }

  /** ===== Leaderboard manual sync ===== */
  async function syncToMGID() {
    if (!game || !personalAddr) return;
    try {
      const tx = await game.syncPlayer(personalAddr);
      await tx.wait();
      setStatus("Synced ✓ to global leaderboard.");
    } catch (e:any) {
      setStatus(`Sync failed: ${e?.message || e}`);
    }
  }

  return (
    <div className="game-container">
      <div className="game-header">
        <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', width: '100%', marginBottom: '15px'}}>
          <button className="btn-primary btn-medium" onClick={() => window.location.href = "index.html"} style={{position: 'absolute', left: 0}}>
            <span className="btn-icon">←</span> Back to Home
          </button>
          <div style={{textAlign: 'center'}}>
            <h1 className="game-title">Monazuki: Neon Trials</h1>
            <div className="game-subtitle">Navigate the neon-lit paths of the cybercity</div>
          </div>
        </div>
      </div>

      {/* Connect personal wallet */}
      {!personalAddr ? (
        <div className="game-section">
          <button className="btn-primary btn-large" onClick={connectWallet}>
            <span className="btn-icon">🎮</span> Enter the Neon Trails
          </button>
        </div>
      ) : (
        <div className="game-section">
          <div className="wallet-info">
            <span className="wallet-label">Connected Wallet:</span>
            <code className="wallet-address">{personalAddr}</code>
          </div>
        </div>
      )}

      {/* MGID (Privy) */}
      <div className="game-section neon-border">
        <h2 className="section-title">Monad Games ID</h2>
        <div className="mgid-info">
          <div className="info-row">
            <span className="info-label">MGID Wallet:</span>
            <code className="info-value">{mgidAddr || "-"}</code>
          </div>
          <div className="info-row">
            <span className="info-label">Username:</span>
            <code className="info-value">{mgidUsername || "-"}</code>
          </div>
        </div>

        <div className="button-group">
          {/* Hide link button once MGID is detected */}
          {!mgidAddr && (
            <button className="btn-secondary" onClick={linkMGIDPrivyFlow} disabled={linking}>
              {linking ? "Linking…" : "Link your Monad Games ID"}
            </button>
          )}
          <button className="btn-secondary" onClick={bindMGIDOnChain} disabled={!mgidAddr || !personalAddr}>Bind MGID on-chain</button>
          <button className="btn-secondary" onClick={syncToMGID} disabled={!personalAddr}>Sync to MGID Leaderboard</button>
          <a href={MGID_LEADERBOARD_URL} target="_blank" rel="noreferrer">
            <button className="btn-secondary">View Global Leaderboard</button>
          </a>
        </div>

        <div className="section-note">
          Binding is optional. It maps your personal wallet to your MGID wallet for global exports.
        </div>
      </div>

{/* Fuel / start */}
<div className="game-section neon-border">
  <h2 className="section-title">Fuel Your Journey</h2>
  <div className="button-group">
    <button className="btn-action" onClick={loadOE} disabled={!personalAddr || loadingNFTs}>
      {loadingNFTs ? (
        <>
          <span className="btn-icon">⏳</span> Loading NFTs...
        </>
      ) : (
        <>
          <span className="btn-icon">🔍</span> Load your NFT
        </>
      )}
    </button>
    <button className="btn-action" onClick={startGame} disabled={!personalAddr || tokenIds.length === 0}>
      <span className="btn-icon">🔥</span> Start Game
    </button>
  </div>
  
  {/* NFT Loading Indicator */}
  {loadingNFTs && (
    <div className="nft-loading">
      <div className="loading-spinner"></div>
      <p>Scanning your wallet for OE NFTs...</p>
    </div>
  )}
  
  {/* NFT Results */}
  {!loadingNFTs && (
    <div className="nft-results">
      {tokenIds.length > 0 ? (
        <>
          <div className="success-message">
            <span className="success-icon">✅</span> 
            Found {tokenIds.length} OE NFT{tokenIds.length !== 1 ? 's' : ''} in your wallet!
          </div>
          <div className="token-list">
            <span className="token-label">Token IDs detected:</span>
            <div className="token-badges">
              {tokenIds.map(id => (
                <span key={id} className="token-badge">{id}</span>
              ))}
            </div>
          </div>
          <div className="nft-instruction">
            You can now start the game by clicking "Start Game".
          </div>
        </>
      ) : (
        <div className="no-nfts-message">
          <span className="warning-icon">⚠️</span>
          No OE NFTs found in your wallet.
          <div className="no-nfts-help">
            You need at least one OE NFT to play. You can acquire one from the marketplace.
            <a href={MARKET_URL} target="_blank" rel="noreferrer" className="marketplace-link">
              Get OE NFTs on Magic Eden
            </a>
          </div>
        </div>
      )}
    </div>
  )}
</div>

      {/* Scene block */}
      <div className="game-section neon-border scene-container">
        <h2 className="section-title">Current Scene</h2>
        <div className="scene-id">
  {p_atScene ? (
    <>
      <span className="scene-name">{getSceneName(p_atScene)}</span>
    </>
  ) : (
    "—"
  )}
</div>
        <div className="scene-text">{sceneText || "—"}</div>

        {/* Choices */}
        {sceneNext.length > 0 && !sceneIsEnding && (
          <div className="choices-container">
            <h3 className="choices-title">Choose Your Path:</h3>
            {sceneNext.map((_nid, i) => (
              <button key={i} className="btn-choice" onClick={() => chooseMove(i)}>
                <span className="choice-icon">🔮</span> {sceneOptions[i]}
              </button>
            ))}
          </div>
        )}

        {/* Ending */}
        {sceneIsEnding && (
          <div className={`ending-message ${sceneVictory ? 'victory' : 'game-over'}`}>
            {sceneVictory 
              ? "🎉 Victory! If you are within the first 100, your badge will be minted automatically." 
              : "💀 Game Over. Wait for the restart cooldown then try again."}
          </div>
        )}

        {/* Cooldowns */}
        <div className="cooldown-container">
          <div className="cooldown-item">
            <span className="cooldown-label">Move cooldown:</span>
            <span className="cooldown-value">{nowMs < canMoveAtMs ? `⏳ ${fmtDuration(canMoveAtMs - nowMs)}` : "✅ Ready"}</span>
          </div>
          <div className="cooldown-item">
            <span className="cooldown-label">Restart cooldown:</span>
            <span className="cooldown-value">{nowMs < canRestartAtMs ? `⏳ ${fmtDuration(canRestartAtMs - nowMs)}` : "✅ Ready"}</span>
          </div>
        </div>

        {/* Side actions */}
        <div className="side-actions">
          <h3 className="actions-title">Side Actions</h3>
          <div className="button-group">
            <button className="btn-side-action" onClick={doTrail} disabled={!personalAddr || !p_started || p_finished}>
              <span className="btn-icon">👣</span> Leave a Trail
            </button>
            <button className="btn-side-action" onClick={doRest} disabled={!personalAddr || !p_started || p_finished}>
              <span className="btn-icon">🧘</span> Catch Your Breath
            </button>
            <button className="btn-side-action" onClick={doExamine} disabled={!personalAddr || !p_started || p_finished}>
              <span className="btn-icon">🔎</span> Study the Signs
            </button>
            <div className="offer-action">
              <input
                value={shrineValue}
                onChange={(e) => setShrineValue(e.target.value)}
                className="offer-input"
                placeholder="0.01"
              />
              <button className="btn-side-action" onClick={doOffer} disabled={!personalAddr || !p_started || p_finished}>
                <span className="btn-icon">⚡</span> Make an Offering
              </button>
            </div>
          </div>
        </div>

        <div className="section-note">
          Optional side actions enrich your run and <b>carry a chance to trigger random MON rewards</b>.
          They don't decide your path to victory, but they make your journey more rewarding and help your presence stand out on the global leaderboard.
        </div>
      </div>

      {/* Progress / status */}
      <div className="game-section status-container">
        <div className="status-message">{status}</div>
        <div className="stats-container">
          <div className="stat-item">
            <span className="stat-label">Score:</span>
            <span className="stat-value">{p_localScore}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Winners:</span>
            <span className="stat-value">{winnersTotal}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Badge:</span>
            <span className="stat-value">{badgeOwned ? "✅ Yes" : "❌ No"}</span>
          </div>
        </div>
      </div>

      {/* ===== About / FAQ ===== */}
      <div className="game-section faq-container">
        <h2 className="section-title">About Monazuki: Neon Trials</h2>
        <p className="faq-text">
          Monazuki: Neon Trials is a narrative, choice-based on-chain game on Monad Testnet.
          Every run begins by burning one OE NFT as "fuel". Navigate neon-lit scenes and pick routes.
          Choose wisely—some paths lead to a victory ending while others end your run immediately.
        </p>

        <h3 className="faq-subtitle">How to begin</h3>
        <ol className="faq-list">
          <li>Connect your personal wallet (e.g., MetaMask) on Monad Testnet.</li>
          <li>Link your Monad Games ID (MGID) via Privy, then press <i>Bind MGID on-chain</i> (optional, recommended for global leaderboard).</li>
          <li>Click <b>Load your NFT</b> to fetch your OE token IDs.</li>
          <li>Click <b>Start Game</b> — you'll be prompted to enter a <b>tokenId</b> to burn as fuel.</li>
        </ol>
        <p className="faq-note">
          <b>Note:</b> Approval is <u>for all your Monazuki NFTs</u>. After a Game Over (or when starting a new run with a different NFT), you only need enter your token ids when start new game.
        </p>

        <h3 className="faq-subtitle">Gas requirement</h3>
        <p className="faq-text">You need a small amount of MON for each transaction (start, choose, and optional actions).</p>

        <h3 className="faq-subtitle">Where to get the OE NFT</h3>
        <p className="faq-text">
          You can buy the OE NFT from the secondary marketplace:&nbsp;
          <a href={MARKET_URL} target="_blank" rel="noreferrer" className="faq-link">Magic Eden — OE on Monad Testnet</a>.
        </p>

        <h3 className="faq-subtitle">How to play</h3>
        <ul className="faq-list">
          <li>After starting, your current Scene and story text will appear.</li>
          <li>Click one of the <i>Choose path</i> buttons to move along the route (obeying the move cooldown).</li>
          <li>If you reach a Victory ending, and you are among the first 100 finishers, you'll automatically receive the Monazuki Badge NFT.</li>
          <li>If you hit a Game Over, wait for the restart cooldown, then burn another OE to try again.</li>
          <li>Optional side actions can be performed anytime during a run and <b>may randomly grant MON rewards</b>.</li>
        </ul>

        <h3 className="faq-subtitle">Global leaderboard</h3>
        <p className="faq-text">
          Bind your MGID on-chain and press <i>Sync to MGID Leaderboard</i> to export your progress.
          You can view the global standings here:&nbsp;
          <a href={MGID_LEADERBOARD_URL} target="_blank" rel="noreferrer" className="faq-link">MGID Leaderboard</a>.
        </p>
      </div>

      <style>{`
        :root {
          --color-primary: #F9B5D0; 
          --color-secondary: #B980F0; 
          --color-accent: #FFD6E0; 
          --color-dark: #0f0f0f; 
          --color-light: #ffffff; 
          --font-heading: 'Arial Rounded MT Bold', 'Arial', sans-serif;
          --font-body: 'Segoe UI', 'Helvetica Neue', sans-serif;
        }

        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        body {
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          color: var(--color-light);
          font-family: var(--font-body);
          line-height: 1.6;
          padding: 0;
          margin: 0;
        }

        .game-container {
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
        }

        .game-header {
          text-align: center;
          margin-bottom: 30px;
          padding: 20px 0;
        }

        .game-title {
          font-family: var(--font-heading);
          font-size: 2.5rem;
          color: var(--color-primary);
          text-shadow: 0 0 10px rgba(249, 181, 208, 0.5);
          margin-bottom: 10px;
        }

        .game-subtitle {
          font-size: 1.2rem;
          color: var(--color-accent);
          opacity: 0.8;
        }

        .game-section {
          background: rgba(15, 15, 15, 0.7);
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 20px;
          backdrop-filter: blur(10px);
        }

        .neon-border {
          border: 1px solid var(--color-secondary);
          box-shadow: 0 0 10px rgba(185, 128, 240, 0.3), 
                      inset 0 0 10px rgba(185, 128, 240, 0.1);
        }

        .section-title {
          font-family: var(--font-heading);
          color: var(--color-primary);
          margin-bottom: 15px;
          font-size: 1.5rem;
        }

        .wallet-info {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .wallet-label {
          color: var(--color-accent);
          font-weight: bold;
        }

        .wallet-address {
          background: rgba(185, 128, 240, 0.2);
          padding: 5px 10px;
          border-radius: 6px;
          font-size: 0.9rem;
          color: var(--color-light);
        }

        .mgid-info {
          margin-bottom: 15px;
        }

        .info-row {
          display: flex;
          align-items: center;
          margin-bottom: 8px;
          flex-wrap: wrap;
        }

        .info-label {
          color: var(--color-accent);
          min-width: 120px;
          font-weight: bold;
        }

        .info-value {
          background: rgba(185, 128, 240, 0.2);
          padding: 4px 8px;
          border-radius: 6px;
          font-size: 0.9rem;
          color: var(--color-light);
        }

        .button-group {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 15px;
        }

        button {
          background: linear-gradient(135deg, var(--color-secondary) 0%, #8a2be2 100%);
          color: white;
          border: none;
          border-radius: 8px;
          padding: 10px 15px;
          font-family: var(--font-body);
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          gap: 5px;
        }

        button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(185, 128, 240, 0.4);
        }

        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }

        .btn-primary {
          background: linear-gradient(135deg, var(--color-primary) 0%, #ff6b9d 100%);
          font-size: 1.1rem;
          padding: 12px 20px;
        }

        .btn-large {
          padding: 15px 25px;
          font-size: 1.2rem;
        }

        .btn-medium {
          padding: 10px 18px;
          font-size: 1rem;
        }

        .btn-secondary {
          background: rgba(185, 128, 240, 0.2);
          border: 1px solid var(--color-secondary);
        }

        .btn-action {
          background: linear-gradient(135deg, #ff6b9d 0%, #ff3d7f 100%);
        }

        .btn-choice {
          background: linear-gradient(135deg, var(--color-secondary) 0%, #6a0dad 100%);
          padding: 15px 20px;
          font-size: 1rem;
          margin: 8px 0;
          width: 100%;
          text-align: left;
          border: 1px solid rgba(185, 128, 240, 0.5);
          border-radius: 8px;
          transition: all 0.3s ease;
        }

        .btn-choice:hover {
          transform: translateX(5px);
          box-shadow: 0 5px 15px rgba(185, 128, 240, 0.4);
          background: linear-gradient(135deg, var(--color-secondary) 0%, #8a2be2 100%);
        }

        .btn-side-action {
          background: rgba(249, 181, 208, 0.2);
          border: 1px solid var(--color-primary);
          color: var(--color-accent);
        }

        .btn-icon {
          font-size: 1.1rem;
        }

        .choice-icon {
          margin-right: 10px;
          font-size: 1.2rem;
        }

        .section-note {
          font-size: 0.9rem;
          color: var(--color-accent);
          opacity: 0.8;
          margin-top: 10px;
        }

        /* NFT Loading Styles */
        .nft-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin: 20px 0;
          padding: 15px;
          background: rgba(185, 128, 240, 0.1);
          border-radius: 8px;
        }

        .loading-spinner {
          width: 40px;
          height: 40px;
          border: 4px solid rgba(185, 128, 240, 0.3);
          border-radius: 50%;
          border-top: 4px solid var(--color-secondary);
          animation: spin 1s linear infinite;
          margin-bottom: 10px;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .nft-loading p {
          margin: 0;
          color: var(--color-accent);
        }

        /* NFT Results Styles */
        .nft-results {
          margin-top: 15px;
        }

        .success-message {
          display: flex;
          align-items: center;
          gap: 10px;
          color: #6ef78a;
          font-weight: bold;
          margin-bottom: 15px;
          padding: 10px;
          background: rgba(110, 247, 138, 0.1);
          border-radius: 8px;
        }

        .success-icon {
          font-size: 1.2rem;
        }

        .token-list {
          margin-bottom: 15px;
        }

        .token-label {
          color: var(--color-accent);
          font-weight: bold;
          margin-right: 10px;
          display: block;
          margin-bottom: 8px;
        }

        .token-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .token-badge {
          background: rgba(185, 128, 240, 0.2);
          color: var(--color-light);
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 0.9rem;
          border: 1px solid var(--color-secondary);
        }

        .nft-instruction {
          padding: 12px;
          background: rgba(249, 181, 208, 0.1);
          border-radius: 8px;
          border-left: 3px solid var(--color-primary);
          color: var(--color-accent);
        }

        .no-nfts-message {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 15px;
          background: rgba(255, 128, 128, 0.1);
          border-radius: 8px;
          border: 1px solid rgba(255, 128, 128, 0.3);
          color: #ff8080;
        }

        .warning-icon {
          font-size: 1.5rem;
          margin-bottom: 5px;
        }

        .no-nfts-help {
          margin-top: 10px;
          font-size: 0.9rem;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .marketplace-link {
          color: var(--color-primary);
          text-decoration: none;
          font-weight: bold;
          padding: 8px 12px;
          background: rgba(249, 181, 208, 0.2);
          border-radius: 6px;
          text-align: center;
          transition: all 0.3s ease;
        }

        .marketplace-link:hover {
          background: rgba(249, 181, 208, 0.3);
          transform: translateY(-2px);
        }

        .scene-container {
          background: rgba(15, 15, 15, 0.8);
        }

        .scene-id {
          margin-bottom: 15px;
          color: var(--color-accent);
        }

        .scene-text {
          white-space: pre-wrap;
          line-height: 1.8;
          margin-bottom: 20px;
          padding: 15px;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 8px;
          border-left: 3px solid var(--color-primary);
        }
        
        .scene-name {
          font-weight: bold;
          color: var(--color-primary);
          font-size: 1.2rem;
        }

        

        .choices-container {
          margin-bottom: 20px;
        }

        .choices-title {
          color: var(--color-primary);
          margin-bottom: 15px;
          text-align: center;
          font-family: var(--font-heading);
        }

        .ending-message {
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 20px;
          text-align: center;
          font-weight: bold;
          font-size: 1.1rem;
        }

        .victory {
          background: rgba(0, 255, 0, 0.1);
          border: 1px solid rgba(0, 255, 0, 0.3);
          color: #6ef78a;
        }

        .game-over {
          background: rgba(255, 0, 0, 0.1);
          border: 1px solid rgba(255, 0, 0, 0.3);
          color: #ff8080;
        }

        .cooldown-container {
          display: flex;
          flex-wrap: wrap;
          gap: 20px;
          margin-bottom: 20px;
        }

        .cooldown-item {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .cooldown-label {
          color: var(--color-accent);
          font-size: 0.9rem;
        }

        .cooldown-value {
          font-weight: bold;
        }

        .side-actions {
          margin-bottom: 20px;
        }

        .actions-title {
          color: var(--color-primary);
          margin-bottom: 10px;
          font-size: 1.2rem;
        }

        .offer-action {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .offer-input {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid var(--color-secondary);
          border-radius: 6px;
          padding: 8px 12px;
          color: white;
          width: 120px;
        }

        .status-container {
          text-align: center;
        }

        .status-message {
          font-size: 1.1rem;
          margin-bottom: 15px;
          color: var(--color-accent);
          font-style: italic;
        }

        .stats-container {
          display: flex;
          justify-content: center;
          flex-wrap: wrap;
          gap: 20px;
        }

        .stat-item {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .stat-label {
          color: var(--color-accent);
          font-size: 0.9rem;
        }

        .stat-value {
          font-weight: bold;
          font-size: 1.2rem;
          color: var(--color-primary);
        }

        .faq-container {
          background: rgba(15, 15, 15, 0.9);
        }

        .faq-text {
          margin-bottom: 15px;
          line-height: 1.7;
        }

        .faq-subtitle {
          color: var(--color-primary);
          margin: 20px 0 10px 0;
          font-size: 1.2rem;
        }

        .faq-list {
          padding-left: 20px;
          margin-bottom: 15px;
        }

        .faq-list li {
          margin-bottom: 8px;
        }

        .faq-link {
          color: var(--color-secondary);
          text-decoration: none;
        }

        .faq-link:hover {
          text-decoration: underline;
        }

        .faq-note {
          font-size: 0.9rem;
          color: #aaa;
          margin-top: 10px;
          line-height: 1.5;
          font-style: italic;
        }

        /* Responsive styles */
        @media (max-width: 768px) {
          .game-container {
            padding: 10px;
          }
          
          .game-title {
            font-size: 2rem;
          }
          
          .game-subtitle {
            font-size: 1rem;
          }
          
          .game-section {
            padding: 15px;
          }
          
          .button-group {
            flex-direction: column;
          }
          
          .button-group button {
            width: 100%;
          }
          
          .info-row {
            flex-direction: column;
            align-items: flex-start;
            gap: 5px;
          }
          
          .wallet-info {
            flex-direction: column;
            align-items: flex-start;
            gap: 5px;
          }
          
          .cooldown-container {
            flex-direction: column;
            gap: 10px;
          }
          
          .offer-action {
            flex-direction: column;
            align-items: stretch;
          }
          
          .offer-input {
            width: 100%;
          }
          
          .stats-container {
            flex-direction: column;
            gap: 10px;
          }

          .token-badges {
            justify-content: center;
          }

          .game-header {
            padding: 10px 0;
          }

          .btn-medium {
            position: relative;
            margin-bottom: 10px;
          }
        }

        @media (max-width: 480px) {
          .game-title {
            font-size: 1.8rem;
          }
          
          .section-title {
            font-size: 1.3rem;
          }
          
          button {
            padding: 12px 10px;
            font-size: 0.9rem;
          }
          
          .btn-large {
            font-size: 1.1rem;
          }
        }
      `}</style>
    </div>
  );
}

/** ===================== PROVIDER WRAPPER ===================== */
export default function App() {
  const monadTestnet: any = {
    id: CHAIN_ID_NUM,
    name: "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { http: [MONAD_RPC] },
    blockExplorers: { default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" } },
  };

  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        loginMethodsAndOrder: { primary: ["email", `privy:${MGID_PROVIDER_APP_ID}`] },
        embeddedWallets: { createOnLogin: "off" },
        defaultChain: monadTestnet,
        supportedChains: [monadTestnet],
      }}
    >
      <UI />
    </PrivyProvider>
  );
}
