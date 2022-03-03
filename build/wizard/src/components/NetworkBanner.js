import React from "react";

const NetworkBanner = ({network}) => {
    return (
        <>
            {network === "prater" && (
                <section className="hero is-warning">
                    <div className="hero-body is-small">
                        <p className="has-text-centered">Using the Prater Test Network</p>
                    </div>
                </section>
            )}
            {network && network !== "prater" && network !== "mainnet" && (
                <section className="hero is-danger">
                    <div className="hero-body is-small">
                        <p className="has-text-centered">Wrongly configured NETWORK environment variable: Using mainnet</p>
                    </div>
                </section>
            )}
        </>
    );
};

export default NetworkBanner


