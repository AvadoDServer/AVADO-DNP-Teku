import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner, faBook } from "@fortawesome/free-solid-svg-icons";
import { RestApi } from "./RestApi";
import { logo } from "../Logo"
import { Network } from "./Types";
import ChainStatus from "./ChainStatus";

interface Props {
    api: RestApi | undefined | null
    title: string
    tagline: string
    wikilink: string
    network: Network
}

const Comp = ({ api, title, tagline, wikilink, network }: Props) => {
    const [mode, setMode] = React.useState<String | null>(null);

    React.useEffect(() => {
        if (!api)
            return;
        api.get(`/mode`, res => {
            if (res.status === 200) {
                setMode(res.data.data);
            } else {
                setMode(null)
            }
        }, (e) => {
            setMode(null)
        });
    }, [api]);

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
                        <p>{tagline}</p>
                        <p><a href={wikilink}><FontAwesomeIcon className="fa-book" icon={faBook} /> {title} documentation</a></p>
                    </div>
                    <div className="column">
                        <ChainStatus api={api}
                            prefix="rest"
                            title="Local Beacon Chain (AVADO)"
                            network={network} />
                    </div>
                    <div className="column">
                        <ChainStatus api={api}
                            prefix="failover"
                            title="Failover Beacon Chain"
                            network={network} />
                    </div>
                </div>
            </div>
        </div>
    );

}


export default Comp;
