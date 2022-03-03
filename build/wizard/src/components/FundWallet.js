import React from "react";

// import web3 from "web3";
// const BN = web3.utils.BN;

const FundWallet = ({ utils, nodeStatus, updateNodeStatus, rpdDaemon }) => {

    const [rplPriceData, setRplPriceData] = React.useState();

    React.useEffect(() => {
        rpdDaemon("network rpl-price", (data) => setRplPriceData(data));
    }, []); // eslint-disable-line


    return (
        <div>
            {nodeStatus && nodeStatus.accountAddress && nodeStatus.accountBalances.eth !== null && nodeStatus.accountBalances.eth <= 0 && (
                <>
                    <h2 className="title is-3 has-text-white">Fund wallet</h2>
                    {rplPriceData && (
                        <>
                            <p>Before you can... fund your wallet ({utils.etherscanAddressUrl(nodeStatus.accountAddress)})</p>
                            <p>Requirements:</p>
                            <ul>
                                <li>ETH: minimum 16 ETH (+ gas money)</li>
                                <li>RPL: minimum {Math.ceil(utils.displayAsETH(rplPriceData.minPerMinipoolRplStake))} RPL,
                                    maximium {Math.floor(utils.displayAsETH(rplPriceData.maxPerMinipoolRplStake))}
                                </li>

                            </ul>
                            <p>Node Funding:</p>
                            <ul>
                                <li><b>ETH: </b>{utils.displayAsETH(nodeStatus.accountBalances.eth)} </li>
                                <li><b>RPL: </b>{utils.displayAsETH(nodeStatus.accountBalances.rpl)} </li>
                            </ul>
                        </>
                    )}
                    <button className="button" onClick={updateNodeStatus}>Refresh</button>
                </>
            )}
        </div>
    );
};

export default FundWallet