import React from "react";
import PropTypes from "prop-types";
import {beaconChainBaseUrl} from "./utils"

function url(validatorPubkey) {
    return beaconChainBaseUrl + "/validator/" + validatorPubkey + "#rocketpool";
}

const BeaconchainLink = ({ validator }) => {
    if (!validator)
        return (
            <>
            </>
        );
    return (
        <>
            <h2>Validator {validator.index}</h2>
            <p><b>Status:</b> {validator.status}</p>
            <p><b>Active:</b> {validator.active?"true":"false"}</p>
            <p><a href={url(validator.pubkey)}>More validator info on the Ethereum 2.0 Beacon Chain Explorer</a></p>
        </>
    );
};

BeaconchainLink.defaultProps = {
    title : ""
}

// BeaconchainLink.prototypes = {
//     title: PropTypes.string
// }

export default BeaconchainLink