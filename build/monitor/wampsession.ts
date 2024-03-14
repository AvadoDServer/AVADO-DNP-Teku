const config = {
    autobahnURL: "ws://wamp.my.ava.do:8080/ws",
    autobahnRealm: "dappnode_admin",
}

let openCount=0, closeCount=0;

import autobahn from "autobahn";

const stats = (reason:string) =>{
   console.log(`${reason} : openCount=${openCount} - closeCount=${closeCount}`);
}

const open = () => {
    const connection = new autobahn.Connection({ url: config.autobahnURL, realm: config.autobahnRealm });
    return new Promise((resolve, reject) => {
        connection.onopen = (session: autobahn.Session)  => {
            // console.log(`WAMP: connected to ${config.autobahnURL}`);
            openCount++;
            stats("opening");
            resolve({ connection, session });
        };
        connection.open();
    });
}

const close = (connection: any) => {
    return new Promise((resolve, reject) => {
        connection.onclose = (/*reason, details */) => {
            // console.log("WAMP: connection closed (CONNECTION_CLOSE)", { reason });
            closeCount++;
            stats("closing");
            return resolve(null);
        };
        connection.close();
    });
}

export { open, close };