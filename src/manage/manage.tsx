import React from "react";
import ReactDOM from "react-dom/client";
import ManageApp from "./ManageApp";
import "./manage.css";

const root = document.getElementById("manage");
if (root) ReactDOM.createRoot(root).render(<React.StrictMode><ManageApp /></React.StrictMode>);
