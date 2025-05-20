import React, { useState, useEffect } from "react";
import {
  callProvider,
  fetchAll,
  fetchCategory,
  searchDB,
} from "../logic/calls";
import { AllProviders, Provider, ProviderJson } from "../logic/types";

const Main: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<ProviderJson[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [calling, setCalling] = useState<ProviderJson>();

  // Import our.js from the host URL
  useEffect(() => {
    const script = document.createElement("script");
    script.src = window.location.origin + "/our.js";
    document.head.appendChild(script);
  }, []);

  useEffect;
  // useEffect(() => {
  //   fetchAll().then((data) => {
  //     if ("error" in data) setSearchError("error fetching data");
  //     else setData(data.ok);
  //   });
  // }, []);

  // function handleSearch() {
  //   setSearchResults([]);
  //   setSearchError("");
  //   console.log("lol", input);
  //   const inp = input.toLowerCase();
  //   for (let provlist of Object.values(data)) {
  //     for (let prov of provlist) {
  //       if (
  //         prov.category.toLowerCase().includes(inp) ||
  //         prov.description.toLowerCase().includes(inp) ||
  //         prov.name.toLowerCase().includes(inp) ||
  //         prov.providerName.toLowerCase().includes(inp) ||
  //         prov.site.toLowerCase().includes(inp)
  //       )
  //         setSearchResults((s) => [...s, prov]);
  //     }
  //   }
  //   console.log(searchResults.length, "length");
  //   if (searchResults.length === 0) setSearchError("No providers found");
  // }
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchResults([]);
    setSearchError("");
    const inp = input.toLowerCase();
    setLoading(true);
    const res = await searchDB(inp);
    console.log({ res });
    if ("error" in res) setSearchError("error searching index");
    else {
      setSearchResults(res.ok);
      if (res.ok.length === 0) setSearchError("No providers found");
    }
    setLoading(false);
  }

  return (
    <div className="explorer-container">
      <div className="search-container">
        {searchError && <div className="search-error">{searchError}</div>}
        <form onSubmit={handleSearch}>
          <input
            type="text"
            name="search"
            placeholder="Steam"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setSearchError("");
            }}
            className="search-input"
          />
          <button type="submit" className="search-button">
            Search
          </button>
        </form>
      </div>
      {loading ? (
        <p>Searching...</p>
      ) : (
        searchResults.length > 0 && (
          <SearchResults results={searchResults} setCalling={setCalling} />
        )
      )}
      {calling && (
        <CallModal provider={calling} cancel={() => setCalling(undefined)} />
      )}
    </div>
  );
};

export default Main;
// TODO we might want to allow icons or images for the providers and more cosmetic stuff
function SearchResults({
  results,
  setCalling,
}: {
  setCalling: (p: ProviderJson) => void;
  results: ProviderJson[];
}) {
  return (
    <div className="search-results-container">
      {results.map((r) => (
        <div className="search-result" key={r.name + r.provider_id}>
          <h3>{r.provider_name || r.name}</h3>
          <p>Node ID: <code>{r.provider_id}</code></p>
          <p>Description: {r.description}</p>
          <p>Category: {r.category}</p>
          <p>Price: {r.price || 'N/A'}</p>
          {r.site && <a href={r.site} target="_blank" rel="noopener noreferrer">Visit Site</a>}
        </div>
      ))}
    </div>
  );
}
function CallModal({
  provider,
  cancel,
}: {
  cancel: () => void;
  provider: ProviderJson;
}) {
  const buntArgs = { example: "lol" };
  const [callArgs, setArgs] = useState<Record<string, any>>({ example: "lol" });
  async function doCall() {
    console.log("calling...", provider);
    const args = {};
    const res = await callProvider(provider, args);
  }
  return (
    <div id="modal-bg">
      <div id="modal-fg">
        <div>
          <p>Name: {provider.name}</p>
          <p>Description: {provider.description}</p>
          <p>Price: {provider.name}</p>
          <div>
            <p>Arguments:</p>
            {Object.entries(provider.arguments || buntArgs).map(([k, v]) => (
              <div>
                <label>
                  {k}:
                  <input
                    style={{ marginLeft: "1rem" }}
                    value={callArgs[v]}
                    onChange={(e) =>
                      setArgs((a) => ({ ...a, [k]: e.target.value }))
                    }
                  />
                </label>
              </div>
            ))}
          </div>
        </div>
        <div className="buttons">
          <button onClick={doCall}>Call</button>
          <button onClick={cancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
