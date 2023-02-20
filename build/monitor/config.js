

const dev = false;
const network = "prater";

exports.server_config = {
    monitor_url: dev ? "http://localhost:9999" : "http://nimbus.my.ava.do:9999",
    network: network,
    keymanager_token_path: dev ? "./test/token" : `/data/data-${network}/keymanagertoken` ,
    dev: dev
}

