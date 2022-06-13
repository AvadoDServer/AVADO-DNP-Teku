import React from "react";
import { Link , NavLink } from "react-router-dom";

const NavigationBar = () => {

    const [navBarIsActive, setNavBarIsActive] = React.useState(false);

    return (
        <nav className="navbar" role="navigation" aria-label="main navigation">
            <div className="navbar-brand">
                <NavLink
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
                </NavLink>
            </div>
            <div id="navMenu" className={`navbar-menu ${navBarIsActive ? "is-active" : ""}`}>
                <div className="navbar-start">
                    <NavLink className={(isActive) => isActive ? "navbar-item is-active has-text-weight-bold" : "navbar-item" } to="/" exact >Main</NavLink>
                    <NavLink className={(isActive) => isActive ? "navbar-item is-active has-text-weight-bold" : "navbar-item" } to="/settings" >Settings</NavLink>
                </div>

                <div className="navbar-end">
                    {/* <NavLink className={({ isActive }) => isActive ? "navbar-item is-active has-text-weight-bold" : "navbar-item" } to="/admin" >Admin</NavLink> */}
                    <NavLink className={(isActive) => isActive ? "navbar-item is-active has-text-weight-bold" : "navbar-item" } to="/admin" >Admin</NavLink>
                </div>
            </div>

        </nav>
    )
};

export default NavigationBar