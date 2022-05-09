import React from "react";

const NetworkBanner = ({network}) => {
    return (
        <>
            {(network === "prater" || network === "kiln") && (
                <section className="hero is-warning">
                    <div className="hero-body is-small">
                        <p className="has-text-centered">Using the {network} test network</p>
                    </div>
                </section>
            )}
            {network && network !== "prater" && network !== "mainnet" && network !== "kiln" && (
                <section className="hero is-danger">
                    <div className="hero-body is-small">
                        <p className="has-text-centered">Wrong configuration</p>
                    </div>
                </section>
            )}
        </>
    );
};

export default NetworkBanner


