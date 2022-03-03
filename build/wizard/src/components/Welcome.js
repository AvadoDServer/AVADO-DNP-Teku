import React from "react";
import Spinner from "./Spinner";

const Welcome = ({ nodeSyncStatus, setNavBar }) => {

    const StatusButton = () => {
        if (!nodeSyncStatus) {
            return (
                <>
                    <span className="icon-text">
                        <p><span className="icon">
                            <Spinner />
                        </span>
                            <span>Waiting for node initialization</span>
                        </p>
                    </span>
                </>
            )
        }

        if (!nodeSyncStatus.eth1Synced) {
            return (
                <>
                    <span className="icon-text">
                        <p><span className="icon">
                            <Spinner />
                        </span>
                            <span>Please wait until your ETH1 node is synced</span>
                        </p>
                    </span>
                    <br />
                    <button className="button" disabled>Start setup</button>
                </>
            )
        }

        if (!nodeSyncStatus.eth2Synced) {
            return (
                <>
                    <span className="icon-text">
                        <p><span className="icon">
                            <Spinner />
                        </span>
                            <span>Please wait until your Beacon chain node is synced</span>
                        </p>
                    </span>
                    <br />
                    <button className="button" disabled>Start setup</button>
                </>
            )
        }

        return (<button className="button" onClick={() => { setNavBar("Setup") }} >Start setup</button>)

    }

    return (
        <div>

            <div className="content">
                <div className="is-size-2">Run a RocketPool Minipool on your AVADO</div>
                <p></p>
                <p>To complete the onboarding wizard you will need these things:</p>
                <ol>
                    <li>A fully synced Ethereum node. Install the <b>Ethereum Node (Geth)</b> from the <a target="_blank" href="http://my.ava.do/#/installer">DappStore</a></li>
                    <li>A fully synced Beacon chain. Install the <b>Prysm ETH2.0 Beacon Chain</b> from the <a target="_blank" href="http://my.ava.do/#/installer">DappStore</a></li>
                    <li>An Ethereum wallet with 16 ETH + some gas to deposit it in your minipool</li>
                    <li>An Ethereum wallet with the neccesary amount of RPL to stake.</li>
                </ol>
                <p>Check the <a target="_blank" href="https://wiki.ava.do/en/tutorials/rocketpool">Avado Rocket Pool Wiki page</a> to learn what it takes to run a Rocket Pool node.</p>

                {/* <p>After you checked the risks and responsabilities, and have secured the necessary prerequisites, click <b>Setup</b> in the menu bar to configure your node.</p> */}

                <StatusButton />

            </div>
        </div>

    );
};

export default Welcome


