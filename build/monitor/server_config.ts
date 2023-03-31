import server_config_json from "./server_config.json"

const packageUrl = server_config_json.network === "mainnet" ? `nimbus.my.ava.do` : `nimbus-${server_config_json.network}.my.ava.do`

export const server_config = {
    ...server_config_json,
    keymanager_token_path: `/data/data-${server_config_json.network}/keymanagertoken`,
    rest_url: "http://localhost:5052",
    keymanager_url: "http://localhost:5052"

}
