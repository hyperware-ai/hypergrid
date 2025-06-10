import React, { useState, useRef, useEffect } from "react";
import { searchDB } from "../logic/calls";
import { ProviderJson } from "../logic/types";

const HeaderSearch: React.FC = () => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<ProviderJson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track if a search has been actively performed
  const [hasSearched, setHasSearched] = useState(false); 

  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Perform search when search button is clicked
  const executeSearch = async () => {
    if (!searchTerm.trim()) {
      setSearchResults([]);
      setError("Please enter a search term.");
      setLoading(false); // Ensure loading is false
      setHasSearched(true); // A search was attempted
      setIsDropdownOpen(true); // Keep dropdown open to show message
      return;
    }

    setLoading(true);
    setError(null);
    setHasSearched(true); // Mark that a search is being performed
    setIsDropdownOpen(true); // Ensure dropdown is open for results/loading

    try {
      const res = await searchDB(searchTerm.toLowerCase());
      if ("error" in res) {
        setError("Error searching providers");
        setSearchResults([]);
      } else {
        setSearchResults(res.ok.slice(0, 10));
        if (res.ok.length === 0) {
          setError("No providers found"); // Specific error for no results
        }
      }
    } catch (err) {
      setError("Error searching providers");
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    // If user clears input, or types new text, reset "hasSearched" and error for "no results"
    // and optionally close dropdown or clear results
    if (hasSearched) {
        setHasSearched(false);
    }
    if (error) { // Clear any error when user types
        setError(null);
    }
    if (!e.target.value.trim()) {
        setSearchResults([]); // Clear results if input is empty
        setIsDropdownOpen(false); // Close dropdown if input is empty
    } else {
        // Don't open dropdown just on typing, wait for focus or search action
    }
  };
  
  const handleInputFocus = () => {
    // Open dropdown on focus only if there's a search term and a search has been made, or if there are results
    if (searchTerm.trim() && (hasSearched || searchResults.length > 0 || error)) {
        setIsDropdownOpen(true);
    }
  };

  return (
    <div 
        className="header-search" 
        ref={searchRef} 
        style={{ position: 'relative', display: 'inline-block' }} // For dropdown positioning
    >
      <div 
        className="header-search-input-wrapper" 
        style={{ display: 'flex', alignItems: 'center', border: '1px solid #ccc', borderRadius: '4px' }}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="Search providers..."
          value={searchTerm}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyPress={(e) => {
            if (e.key === 'Enter') {
              executeSearch();
            }
          }}
          className="header-search-input"
          style={{ 
            border: 'none', 
            outline: 'none', 
            boxShadow: 'none',
            padding: '8px 10px', 
            flexGrow: 1,
            borderRadius: '4px 0 0 4px'
          }}
        />
        <button 
          className="header-search-button"
          onClick={executeSearch}
          style={{
            padding: '8px 10px',
            border: 'none',
            background: '#f0f0f0',
            cursor: 'pointer',
            borderLeft: '1px solid #ccc',
            borderRadius: '0 4px 4px 0'
          }}
        >
          <svg 
            width="16" height="16" viewBox="0 0 24 24" 
            fill="none" stroke="currentColor" strokeWidth="2"
            style={{ display: 'block' }} // Prevents extra space below SVG
          >
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.35-4.35"></path>
          </svg>
        </button>
      </div>

      {isDropdownOpen && (
        <div 
            className="header-search-dropdown"
            style={{
                position: 'absolute',
                top: '100%', // Position below the input wrapper
                left: 0,
                right: 0, // Make it full width of the parent
                backgroundColor: 'white',
                border: '1px solid #ddd',
                borderRadius: '0 0 4px 4px',
                boxShadow: '0 4px 8px rgba(0,0,0,0.1)',
                zIndex: 1000, // Ensure it's on top
                maxHeight: '400px',
                overflowY: 'auto',
                marginTop: '2px' // Small gap
            }}
        >
          {loading && (
            <div className="header-search-loading" style={{ padding: '10px', textAlign: 'center' }}>Searching...</div>
          )}
          
          {!loading && error && ( // Display any error, including "No providers found" or "Please enter term"
            <div className="header-search-error" style={{ padding: '10px', color: 'red', textAlign: 'center' }}>{error}</div>
          )}
          
          {!loading && !error && searchResults.length > 0 && (
            <div className="header-search-results">
              {searchResults.map((provider) => (
                <div 
                  key={provider.provider_id || provider.name}
                  className="header-search-result"
                  style={{
                    padding: '10px 12px',
                    borderBottom: '1px solid #eee'
                  }}
                >
                  <div className="header-search-result-name" style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                    {provider.provider_name || provider.name}
                  </div>
                  {provider.provider_id && (
                    <div style={{ fontSize: '0.8em', color: '#666', marginBottom: '4px' }}>
                      Node ID: <code>{provider.provider_id}</code>
                    </div>
                  )}
                  {provider.price && (
                     <div className="header-search-result-details" style={{ fontSize: '0.9em', color: '#555', marginBottom: '4px' }}>
                        <span className="header-search-result-price" style={{ fontWeight: '500' }}>
                            {provider.price} USDC
                        </span>
                    </div>
                  )}
                  {provider.description && (
                    <div className="header-search-result-description" style={{ fontSize: '0.85em', color: '#777', marginBottom: '6px' }}>
                      {provider.description.length > 80 // Slightly shorter for more compact view with new fields
                        ? provider.description.substring(0, 80) + "..." 
                        : provider.description}
                    </div>
                  )}
                  {provider.site && (
                    <div style={{ marginTop: '6px' }}>
                        <a 
                            href={provider.site} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            onClick={(e) => {
                                e.stopPropagation(); // Prevent any parent click handlers if added later
                                setIsDropdownOpen(false); // Close dropdown after clicking site link
                                setSearchTerm(""); 
                                setSearchResults([]); 
                                setError(null);
                                setHasSearched(false);
                            }}
                            style={{ 
                                color: '#007bff', 
                                textDecoration: 'none',
                                fontSize: '0.9em'
                            }}
                        >
                            Visit Site
                        </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* This specific message "No results for..." might be redundant if error state handles it */}
          {/* Considered removing, but kept for now if specific styling is needed later */}
          {!loading && error === "No providers found" && searchTerm.trim() && searchResults.length === 0 && (
             <div className="header-search-no-specific-results" style={{ padding: '10px', textAlign: 'center' }}>No results for "{searchTerm}"</div>
          )}
        </div>
      )}
    </div>
  );
};

export default HeaderSearch; 