import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner, faBook } from "@fortawesome/free-solid-svg-icons";
import { RestApi } from "./RestApi";
import { logo } from "../Logo"
import { Network } from "./Types";
import ChainStatus from "./ChainStatus";

interface Props {
    api: RestApi | undefined | null
    network: Network
}

const Comp = ({ api, network }: Props) => {

    return (
        <div>
            <div className="hero-body is-small is-primary py-0">
                <div className="columns">
                    
                    <div className="column">
                        <span>
                            <h1 className="title is-1 has-text-black">Failover node</h1>
                        </span>
                        <p>As your own node is syncing - your validator will use a failover server provided by AVADO.</p>
                    </div>
                    <div className="column">
                       <ChainStatus api={api} 
                       prefix="failover" 
                       title="Failover Beacon Chain" 
                       network={network}/>
                    </div>
                </div>
            </div>
        </div>
    );

}


export default Comp;
