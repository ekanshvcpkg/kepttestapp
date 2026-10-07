// Polyfills must load before anything that touches Buffer or crypto (web3.js, Anchor).
import "./src/polyfills";

import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
