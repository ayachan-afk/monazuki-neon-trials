# Monazuki: Neon Trials

*Monazuki: Neon Trials* is a narrative, choice-based on-chain game on the *Monad Testnet*.  
Every run begins by burning one OE NFT as “fuel.” You will navigate neon-lit scenes and pick your path. Some choices lead to victory, others end your run immediately.

---

## 🎮 How to Play
Go to our site first - https://monazuki.littlebunnyrocket.com/play.html
1. *Connect your wallet* (e.g. MetaMask) to the Monad Testnet.  
2. *Link your Monad Games ID (MGID)* via Privy and (optionally) bind it on-chain for the global leaderboard.  
3. Click *Load your NFT* to fetch your OE token IDs.  
4. Click *Start Game* → input a tokenId to burn as fuel → approve the transaction.  
5. Read the scene text and click one of the *Choose path* buttons to move forward.  
6. Side actions (leave a trail, rest, examine, offer) can also be performed. These count as extra activity and may trigger small native rewards.  
7. Reach the *Victory Scene* to earn points, and if you’re among the first 100 winners, you’ll automatically receive the Monazuki Badge NFT.

> *Note:* If your run ends in Game Over, you’ll need to start again by burning another OE NFT.

---

## ⚙️ Build & Run Locally

Clone the repository and install dependencies:

bash
git clone https://github.com/ayachan-afk/monazuki-neon-trials.git
cd monazuki-neon-trials
npm install


Run in dev mode:

bash
npm run dev


Build for production:

bash
npm run build


Serve build:

bash
npm run preview


Dependencies are minimal:
- [Privy](https://docs.privy.io/) (latest)  
- Ethers v6  
- Vite + React  

---

## 📂 Environment Variables (.env)

Create a `.env` file with your own settings:

```ini
VITE_PRIVY_APP_ID=your_privy_app_id
VITE_MGID_CROSS_APP_ID=mgid_app_id
VITE_CHAIN_ID=10143
VITE_MONAD_RPC=https://testnet-rpc.monad.xyz
VITE_ALCHEMY_BASE=https://monad-testnet.g.alchemy.com/v2/yourkey
VITE_GAME_ADDR=0xYourGameContract
VITE_OE_ADDR=0xYourOETokenContract
```

---

## 🏆 Leaderboard

- Your personal wallet score is forwarded automatically.  
- To appear on the *global Monad Games ID leaderboard*, bind your MGID on-chain. 
