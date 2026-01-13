import { useState } from "react";
import reactLogo from "./assets/react.svg";
import ClipsContainer from "./components/ClipsContainer"
import PreviewContainer from "./components/PreviewContainer"
import Navbar from "./components/Navbar";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <main>
      <Navbar />
      <div className="main">
        <ClipsContainer />
        <PreviewContainer />
      </div>
    </main>
  );
}

export default App;
