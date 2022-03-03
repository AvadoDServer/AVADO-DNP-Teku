import React from "react";
import SyncStatusTag from "./SyncStatusTag";
import web3 from "web3";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGasPump, faSatelliteDish } from "@fortawesome/free-solid-svg-icons";
import config from "../config";
import Spinner from "./Spinner";


const Header = ({ utils, rocketpoollogo, nodeSyncStatus, nodeFee, rplPriceData, minipoolStatus }) => {

    const [gasPrice, setGasPrice] = React.useState();

    React.useEffect(() => {
        if (!utils)
            return;
        console.log("Using: " + utils.wsProvider());
        const eth = new web3(utils.wsProvider()).eth;
        const interval = setInterval(() => {
            eth.getGasPrice().then((result) => {
                const currentPrice = parseFloat(web3.utils.fromWei(result, 'gwei')).toFixed(1);
                console.log("Gas: " + currentPrice);
                setGasPrice(currentPrice);
            })
        }, 15 * 1000);
        return () => clearInterval(interval);
    }, [utils]);


    const beaconChainDashboard = (indexes) => indexes ? (<a href={`${utils.beaconChainBaseUrl}/dashboard?validators=` + indexes.join(",")}><FontAwesomeIcon className="icon" icon={faSatelliteDish} /></a>) : "";

    return (
        <div className="hero-body is-small is-primary py-0">
            <div className="columns">
                <div className="column is-narrow">
                    <figure className="image is-64x64">
                        <img src={rocketpoollogo} alt="Rocket Pool logo" />
                    </figure>
                </div>
                <div className="column">
                    <span>
                        <h1 className="title is-1 has-text-white">Avado Rocket Pool</h1>
                    </span>
                    <p>Rocket Pool without the command line</p>
                </div>
                <div className="column">
                    {nodeSyncStatus && (
                        <div>
                            <p className="has-text-right">
                                <SyncStatusTag progress={nodeSyncStatus.eth1Progress} label="ETH1" />&nbsp;
                                <SyncStatusTag progress={nodeSyncStatus.eth2Progress} label="Beacon chain" />
                                {minipoolStatus && minipoolStatus.minipools && (
                                    beaconChainDashboard(minipoolStatus.minipools.filter((minipool) => "validator" in minipool).map((minipool) => minipool.validator.index))
                                )}
                            </p>
                            {nodeSyncStatus.eth1Synced && (
                                <p className="has-text-right">
                                    {gasPrice && (
                                        <>
                                            <span className="icon-text">
                                                <span className="icon">
                                                    <FontAwesomeIcon icon={faGasPump} />
                                                </span>
                                                <span>{gasPrice ? gasPrice : <Spinner />} gwei</span>

                                            </span>,
                                        </>
                                    )}
                                    Node commision: {nodeFee?.nodeFee && utils ? utils.displayAsPercentage(nodeFee.nodeFee * 100) : <Spinner />},
                                    RPL: {rplPriceData && utils ? utils.displayAsETH(rplPriceData.rplPrice, 5) : <Spinner />} ETH
                                </p>
                            )}
                        </div>
                    )}

                </div>
            </div>

        </div>
    );
};

export default Header


