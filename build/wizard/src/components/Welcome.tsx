import React from "react";
import { Link } from "react-router-dom";
import { DappManagerHelper } from "./DappManagerHelper";

interface Props {
    homePageUrl: string
    logo: string
    title: string
    wikiUrl: string
    dappManagerHelper: DappManagerHelper
}

const Welcome = ({ homePageUrl, logo, wikiUrl, title, dappManagerHelper }: Props) => {

    const [executionEngines, setExecutionEngines] = React.useState<string[]>([]);

    const supportedEth1Packages = [
        "ethchain-geth.public.dappnode.eth",
        "avado-dnp-nethermind.public.dappnode.eth"
    ]

    React.useEffect(() => {
        if (dappManagerHelper) {
            dappManagerHelper.getPackages()
                .then(packages => {
                    // check if Execution engine is installed
                    const eth1Nodes = supportedEth1Packages.filter(p => packages.includes(p));
                    setExecutionEngines(eth1Nodes)
                }
                )

        }
    }, [dappManagerHelper])


    return (
        <div>
            <div className="container has-text-centered ">
                <div className="columns is-vcentered">
                    <div className="column">
                        <figure className="image is-64x64 is-inline-block">
                            <img src={logo} alt={`${title} logo`} />
                        </figure>
                        <div className="content">

                            <h1 className="title has-text-white is-2">Welcome to {title}</h1>
                            {
                                !dappManagerHelper ? (
                                    <p>loading...</p>
                                ) : (
                                    <>
                                        <p>You can find more info on the <a href={wikiUrl}>wiki</a> or <a href={homePageUrl}>homepage</a></p>

                                        <p>You can import validators on the <Link to="/">Main page</Link></p>
                                        <p>You can change settings on the <Link to="/settings">Settings page</Link></p>
                                        <p>You can inspect the logs on the <Link to="/admin">Admin page</Link></p>
                                    </>
                                )
                            }
                        </div>
                    </div>
                </div>
            </div>
        </div>

    );
};

export default Welcome


