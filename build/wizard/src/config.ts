

const dev = false;
const network = "prater";

export const server_config = {
    monitor_url: dev ? "http://localhost:9999" : "http://nimbus.my.ava.do:9999",
    network: network,
    name: "Avado Nimbus Prater Testnet",
    keymanager_token_path: dev ? "./test/token" : `/data/data-${network}/keymanagertoken`,    
    dev: dev
}