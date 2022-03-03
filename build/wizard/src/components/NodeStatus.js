import React from "react";
import SyncStatusTag from "./SyncStatusTag";


const NodeStatus = ({ utils, nodeStatus, updateNodeStatus, nodeSyncStatus}) => {
    //{"status":"success","error":"","eth1Progress":1,"eth2Progress":0.999965525074369,"eth1Synced":true,"eth2Synced":false,"eth1LatestBlockTime":1641917772}

    return (
        <div>
            <h2 className="title is-3 has-text-white">Node status</h2>
            {nodeStatus && (
                <div>
                    <table className="table">
                        <tbody>
                            <tr>
                                <td><b>Geth execution node</b></td>                                
                                <td><SyncStatusTag progress={nodeSyncStatus.eth1Progress} /></td>
                            </tr>
                            <tr>
                                <td><b>Beacon chain node</b></td>
                                <td><SyncStatusTag progress={nodeSyncStatus.eth2Progress} /></td>
                            </tr>
                            <tr><td><b>Account address</b></td><td>{utils.etherscanAddressUrl(nodeStatus.accountAddress)}</td></tr>
                            <tr><td><b>Withdrawal address</b></td><td>{utils.etherscanAddressUrl(nodeStatus.withdrawalAddress)}</td></tr>
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default NodeStatus