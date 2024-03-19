import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner, faBook } from "@fortawesome/free-solid-svg-icons";
import { RestApi } from "./RestApi";
import { logo } from "../Logo"
import { Network } from "./Types";
import ChainStatus from "./ChainStatus";

interface Props {
    mode: string | null
    network: Network
}

const Comp = ({ mode, network }: Props) => {

    return (


        <section className="notification">
            <div className="">
                {/* eslint-disable-next-line */}
                <p className="has-text-centered">Zero Sync mode is enabled.
                </p>
            </div>
        </section>

    );

}


export default Comp;
