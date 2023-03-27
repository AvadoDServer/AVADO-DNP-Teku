const config = {
    "network": "prater",
    "name": "teku"
}

const packageUrl = config.network === "mainnet" ? `teku.my.ava.do` : `teku-${config.network}.my.ava.do`

export const server_config = {
    ...config,
    keymanager_token_path: `/data/data-${config.network}/validator/key-manager/validator-api-bearer`,
    rest_url: "http://localhost:5051",
    keymanager_url: `https://${packageUrl}:5052`

}