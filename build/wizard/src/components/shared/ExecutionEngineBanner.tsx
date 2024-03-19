import React from "react";
interface IProps {
    execution_engine: string | undefined,
    installedPackages: string[] | undefined
    wikilink: string
    client: string,
    mode: string | null,
}

const ExecutionEngineBanner = ({ execution_engine, installedPackages, wikilink, client, mode }: IProps) => {

    const isExecutionClientAvailable = () => {
        if (!installedPackages || !execution_engine) {
            return true; // not initialized yet
        }
        return installedPackages.includes(execution_engine)
    }

    return (
        <>
            {!isExecutionClientAvailable() && (mode !== "zerosync") && (
                <section className="notification">
                    <div className="hero-body is-small">
                        {/* eslint-disable-next-line */}
                        <p className="has-text-centered">You did not install an execution client yet, or it is not running. This is required for {client} to work.
                        <br/>
                        <a className="has-text-centered" href={wikilink}><u>Click here for more info.</u>
                        </a></p>
                    </div>
                </section>
            )}
        </>
    );
};

export default ExecutionEngineBanner


