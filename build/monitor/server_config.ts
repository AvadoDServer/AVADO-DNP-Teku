import server_config_json from "./server_config.json";

const packageUrl = server_config_json.network === "mainnet" ?
    `teku.my.ava.do`
    : `teku-${server_config_json.network}.my.ava.do`

export const server_config = {
    ...server_config_json,
    keymanager_token_path: `/data/data-${server_config_json.network}/validator/key-manager/validator-api-bearer`,
    rest_url: "http://localhost:5051",
    keymanager_url: `https://${packageUrl}:5052`

}