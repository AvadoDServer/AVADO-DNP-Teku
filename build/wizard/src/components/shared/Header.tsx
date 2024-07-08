import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner, faBook } from "@fortawesome/free-solid-svg-icons";
import { RestApi } from "./RestApi";
import { logo } from "../Logo"
import { Network } from "./Types";
import ChainStatus from "./ChainStatus";
import TandCModal from "./TandCModal";

interface Props {
    mode: string | null,
    api: RestApi | undefined | null
    title: string
    tagline: string
    wikilink: string
    network: Network
}

const Comp = ({ mode, api, title, tagline, wikilink, network }: Props) => {


    return (
        <div>
            <div className="hero-body is-small is-primary py-0">
                <div className="columns">
                    <div className="column is-narrow">
                        <figure className="image is-128x128">
                            <img src={logo} alt={`${title} logo`} />
                        </figure>
                    </div>
                    <div className="column">
                        <span>
                            <h1 className="title is-1 has-text-black">{title}</h1>
                        </span>
                        <p>
                            {tagline}
                        </p>
                        <p><a href={wikilink}><FontAwesomeIcon className="fa-book" icon={faBook} /> {title} documentation</a></p>
                    </div>
                    <div className="column">
                        <ChainStatus api={api}
                            prefix="rest"
                            title="My Local Beacon Chain"
                            network={network} />
                    </div>
                    {(mode === "zerosync") && (
                        <div className="column">
                            <ChainStatus api={api}
                                prefix="zerosync"
                                title="AVADO's Zero Sync Beacon Chain"
                                network={network} />
                            <TandCModal />
                        </div>

                    )}
                </div>
            </div>
        </div>
    );

}


export default Comp;
