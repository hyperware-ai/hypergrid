import React, { useEffect, useState } from "react";
import { fetchState } from "../logic/calls";

function Indexers() {
  useEffect(() => {
    fetchState().then((s) => {
      if ("error" in s) console.log(s);
      else {
        setIndexers(s.ok.indexers);
        setIndexer(s.ok.indexer);
      }
      console.log(s);
    });
  }, []);
  const [indexers, setIndexers] = useState<string[]>([]);
  const [indexer, setIndexer] = useState(indexers[0]);
  return (
    <div className="indexer-container">
      <h1> Choose Indexer</h1>
      {indexers.map((h) => (
        <div key={h} className="indexer">
          <button
            className={indexer === h ? "selected" : ""}
            onClick={() => setIndexer(h)}
          >
            {h}
          </button>
        </div>
      ))}
    </div>
  );
}

export default Indexers;
