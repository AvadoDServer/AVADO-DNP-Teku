import React from "react";
import { Link } from "react-router-dom";

const NavigationBar = ({ navBar, setNavBar }) => {

    const [navBarIsActive, setNavBarIsActive] = React.useState(false);

    return (
        <nav className="navbar" role="navigation" aria-label="main navigation">
            <div className="navbar-brand">
                <Link
                    to="/"
                    onClick={() => {
                        setNavBarIsActive(!navBarIsActive);
                    }}
                    role="button"
                    className={`navbar-burger burger ${navBarIsActive ? "is-active" : ""}`}
                    aria-label="menu"
                    aria-expanded="false"
                    data-target="navMenu"
                >
                    <span aria-hidden="true"></span>
                    <span aria-hidden="true"></span>
                    <span aria-hidden="true"></span>
                </Link>
            </div>
            <div id="navMenu" className={`navbar-menu ${navBarIsActive ? "is-active" : ""}`}>
                <div className="navbar-start">
                    <Link className={`navbar-item ${navBar === "Welcome" ? "is-active has-text-weight-bold" : ""}`} to="/" onClick={() => { setNavBar("Welcome") }} >Welcome</Link>
                    <Link className={`navbar-item ${navBar === "Setup" ? "is-active has-text-weight-bold" : ""}`} to="/" onClick={() => { setNavBar("Setup") }} >Setup</Link>
                    <Link className={`navbar-item ${navBar === "Status" ? "is-active has-text-weight-bold" : ""}`} to="/" onClick={() => { setNavBar("Status") }} >Status</Link>
                </div>

                <div className="navbar-end">
                    <Link className={`navbar-item ${navBar === "Admin" ? "is-active has-text-weight-bold" : ""}`} to="/" onClick={() => { setNavBar("Admin") }} >Admin</Link>
                </div>
            </div>

        </nav>
    )
};

export default NavigationBar