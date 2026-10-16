// PortaldotV3 Testnet, per the official PortaldotV3 Testnet guide (EVM via pallet-revive).
export const PORTALDOT = {
  chainId: 420420777,
  chainIdHex: "0x190f2309",
  chainName: "PortaldotV3 Testnet",
  rpcUrl: "https://testnetv3-eth-rpc.feso-apps.xyz",
  nativeCurrency: { name: "Portaldot Test Token", symbol: "tPOTv3", decimals: 18 },
  nodeConsole: "https://node-console.feso-apps.xyz/",
};

export async function switchToPortaldot(ethereum) {
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: PORTALDOT.chainIdHex }] });
  } catch (e) {
    if (e.code === 4902 || /Unrecognized chain/i.test(e.message || "")) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: PORTALDOT.chainIdHex,
            chainName: PORTALDOT.chainName,
            rpcUrls: [PORTALDOT.rpcUrl],
            nativeCurrency: PORTALDOT.nativeCurrency,
          },
        ],
      });
    } else throw e;
  }
}
