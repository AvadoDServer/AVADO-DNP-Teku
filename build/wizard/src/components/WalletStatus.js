import React from "react";
import Utils from './utils.js';

const WalletStatus = ({ utils, nodeStatus, updateNodeStatus }) => {
    return (
        <div>
            <h2 className="title is-3 has-text-white">Wallet</h2>
            {nodeStatus && nodeStatus.accountAddress && nodeStatus.accountBalances.eth !== null && nodeStatus.accountBalances.rpl !== null && (
                <div>
                    <table className="table">
                        <tbody>
                            <tr>
                                <td><b>ETH</b></td>                                
                                <td>{utils.displayAsETH(nodeStatus.accountBalances.eth)}</td>
                            </tr>
                            <tr>
                                <td><b>RPL</b></td>
                                <td>{utils.displayAsETH(nodeStatus.accountBalances.rpl)}</td>
                            </tr>
                            <tr><td><b>Account Address</b></td><td>{utils.etherscanAddressUrl(nodeStatus.accountAddress)}</td></tr>
                        </tbody>
                    </table>
                    <button className="button" onClick={updateNodeStatus}>Refresh</button>
                </div>
            )}
        </div>
    );
};

export default WalletStatus