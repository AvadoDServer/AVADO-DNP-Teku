import server_config_json from "./server_config.json";

export const server_config = {
    ...server_config_json,
    keymanager_token_path: `/data/data-${server_config_json.network}/keymanagertoken`,
    rest_url : "http://localhost:5052",
    keymanager_url: "http://localhost:5052"

}