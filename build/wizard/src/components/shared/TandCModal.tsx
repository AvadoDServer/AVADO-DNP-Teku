import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowUpFromBracket, faSatelliteDish } from "@fortawesome/free-solid-svg-icons";

const TandCModal = () => {

    const [modalActive, setModalActive] = useState<boolean>(false);
  

    return (
        <>
        <div className="is-size-7 has-text-right">By using Zero Sync you agree to the Zero Sync<br/><a onClick={() => setModalActive(true)} href="#">Terms and conditions</a></div>

            <div className={"modal" + (modalActive ? " is-active" : "")}>
                <div onClick={() => setModalActive(false)} className="modal-background"></div>
                <div onClick={() => setModalActive(false)} className="modal-card">
                    <header className="modal-card-head">
                        <p className="modal-card-title">Terms and Conditions for Zero Sync Feature in Teku App</p>
                        <button className="delete" aria-label="close" onClick={() => setModalActive(false)}></button>
                    </header>
                    <section className="modal-card-body">
                       
                            <div className="is-size-4">
                        1. Introduction
                        </div>
Welcome to the Zero Sync feature within the Teku app, available on the AVADO Dappstore. By using the Zero Sync feature, you agree to comply with and be bound by the following terms and conditions. Please read them carefully.
<br/><br/><div className="is-size-4">2. Overview of Zero Sync</div>
Zero Sync enables users to quickly synchronize their blockchain and start making attestations immediately. However, this feature comes with certain limitations and disclaimers that users must understand and accept.

<br/><br/><div className="is-size-4">3. Execution and MEV Rewards Disclaimer</div>
<ul>
<li>- Temporary Solution: Zero Sync is intended as a temporary solution to facilitate rapid validator setup. Users must transition to running their own Execution client in sync for optimal performance.</li>
<li>- Reward Handling: While using Zero Sync, execution rewards and MEV rewards will not be transferred to the user's own fee recipient address. Instead, these rewards are sent to an 0x000 address, effectively burning them.</li>
<li>- No Benefits to AVADO: AVADO does not receive the execution or MEV rewards either.</li>
</ul>
<br/><br/><div className="is-size-4">4. User Acknowledgment</div>
By using Zero Sync, you acknowledge and agree to the following:
<ul>
<li>- You understand that Zero Sync is a temporary measure to expedite validator activation.</li>
<li>- You are aware that execution and MEV rewards will be burned while using Zero Sync, and you will not receive these rewards.</li>
<li>- You accept the responsibility to transition to a fully synchronized Execution client for long-term staking operations to ensure that you receive all applicable rewards.</li>
</ul>

<br/><br/><div className="is-size-4">5. Liability</div>
AVADO shall not be liable for any loss of rewards or other damages arising from the use of the Zero Sync feature. Users are encouraged to promptly transition to their own synchronized Execution client.

<br/><br/><div className="is-size-4">6. Amendments</div>
AVADO reserves the right to amend these terms and conditions at any time. Users will be notified of any changes through updates in the Dapp or via Discord.

<br/><br/><div className="is-size-4">7. Governing Law</div>
These terms and conditions are governed by the laws of Switzerland. Any disputes arising from the use of the Zero Sync feature will be subject to the exclusive jurisdiction of the courts in Zug, Switzerland.

<br/><br/><div className="is-size-4">8. Contact Information</div>
For support and inquiries, please contact our support team at saskia@ava.do or open a ticket in Discord.
<br/><br/>
By using the Zero Sync feature, you agree to these terms and conditions. If you do not agree, please do not use this feature and ensure that your validator is fully synchronized using your own Execution client.
<br/><br/>
For more information about Zero Sync, you can read our <a target="_blank" href="https://ava.do/blog/say-goodbye-to-waiting-ethereum-staking-in-minutes-with-avado%E2%80%99s-zero-sync/">blog post</a> 
                           
                     

                    </section>
                    <footer className="modal-card-foot">
                        <button className="button" onClick={() => setModalActive(false)}>Close</button>
                    </footer>
                </div>
            </div>
        </>
    );
};

export default TandCModal
