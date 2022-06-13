
export const supportedNetworks = ["prater", "mainnet", "kiln"]
export type Network = typeof supportedNetworks[number]

export type SettingsType = {
    network: Network
    ee_endpoint: string
    eth1_endpoints: string[]
    validators_graffiti: string,
    p2p_peer_lower_bound: number,
    p2p_peer_upper_bound: number,
    validators_proposer_default_fee_recipient: string,
    initial_state: string
}

export const defaultSettings: SettingsType = {
    network: "mainnet",
    ee_endpoint: "http://geth-kiln.my.ava.do:8551", //FIXME: ethchain wen release
    eth1_endpoints: ["http://ethchain-geth.my.ava.do:8545", "https://mainnet.eth.cloud.ava.do"],
    // eth1_endpoints: ["http://goerli-geth.my.ava.do:8545"],
    validators_graffiti: "Avado",
    p2p_peer_lower_bound: 64,
    p2p_peer_upper_bound: 100,
    validators_proposer_default_fee_recipient: "",
    initial_state: "https://snapshots.ava.do/state.ssz"
}