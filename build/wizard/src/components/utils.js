import React from 'react';
import web3 from "web3";

class Utils {
    constructor(network) {
        this.network = network;
    }

    beaconChainBaseUrl = ({
        "prater": "https://prater.beaconcha.in/",
        "mainnet": "https://beaconcha.in/",
    })[this.network] || "https://beaconcha.in/"

    etherscanBaseUrl = ({
        "prater": "https://goerli.etherscan.io",
        "mainnet": "https://etherscan.io",
    })[this.network] || "https://goerli.etherscan.io"

    beaconchainUrl(validatorPubkey, text) {
        return <a href={this.beaconChainBaseUrl + "/validator/" + validatorPubkey + "#rocketpool"}>{text ? text : validatorPubkey}</a>;
    }

    etherscanAddressUrl(address, text) {
        return <a href={this.etherscanBaseUrl + "/address/" + address}>{text ? text : address}</a>;
    }

    etherscanTransactionUrl(txHash, text) {
        return <a href={this.etherscanBaseUrl + "/tx/" + txHash}>{text ? text : txHash}</a>;
    }

    displayAsETH(number, fractionDigits) {
        if (!number)
            return 0;
        // https://web3js.readthedocs.io/en/v1.2.0/web3-utils.html#fromwei
        const result = web3.utils.fromWei(String(number), 'ether');
        if (fractionDigits)
            return parseFloat(result).toFixed(fractionDigits)
        return result
    }

    displayAsPercentage(number) {
        if (!number)
            return "- %";
        return parseFloat(number).toFixed(2) + "%";
    }

    wsProvider() {
        return ({
            "prater": 'ws://goerli-geth.my.ava.do:8546',
            "mainnet": 'ws://ethchain-geth.my.ava.do:8546',
        })[this.network] || 'ws://ethchain-geth.my.ava.do:8546'
    }
}

export default Utils