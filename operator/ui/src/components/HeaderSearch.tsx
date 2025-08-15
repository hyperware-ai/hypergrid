import React, { useState, useRef, useEffect } from "react";
import { searchDB } from "../logic/calls";
import { ProviderJson } from "../logic/types";
import { PiMagnifyingGlass } from "react-icons/pi";
import classNames from "classnames";

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
      className={classNames("relative flex flex-col gap-2 self-stretch",
      )}
      ref={searchRef}
    >
      <div
        className="flex grow items-stretch gap-1"
      >
        <button
          className="bg-gray dark:bg-dark-gray rounded-full px-3 py-1 hover:bg-mid-gray text-xl"
          onClick={executeSearch}
        >
          <PiMagnifyingGlass className="rotate-90" />
        </button>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search providers..."
          value={searchTerm}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyUp={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
              executeSearch();
            }
          }}
          className="border-none outline-none box-shadow-none py-2 px-4 flex-grow rounded-full bg-gray dark:bg-dark-gray"
        />
      </div>

      {isDropdownOpen && (
        <div
          className="absolute top-full left-0 right-0 z-50 overflow-y-auto mt-2 bg-gray dark:bg-dark-gray p-2 shadow-lg shadow-mid-gray rounded-xl min-h-0 max-h-[80vh]"
          style={{
            scrollbarWidth: 'thin',
          }}
        >
          {loading && (
            <div className="p-2 text-center">Searching...</div>
          )}

          {!loading && error && ( // Display any error, including "No providers found" or "Please enter term"
            <div className="p-2 text-center text-red-500">{error}</div>
          )}

          {!loading && !error && searchResults.length > 0 && searchResults.map((provider, index) => <div
            key={provider.provider_id || provider.name}
            className={classNames("p-2 flex flex-col", {
              'border-b border-gray dark:border-dark-gray': index !== searchResults.length - 1,
            })}
          >
            <div className="font-bold">
              {provider.provider_name || provider.name}
            </div>
            {provider.provider_id && <code className="text-sm text-dark-gray dark:text-gray wrap-anywhere">{provider.provider_id}</code>}
            {provider.price && (
              <div className="font-medium text-sm text-dark-gray dark:text-gray">
                {provider.price} USDC
              </div>
            )}
            {provider.description && (
              <div className="text-sm text-dark-gray dark:text-gray">
                {provider.description.length > 80 // Slightly shorter for more compact view with new fields
                  ? provider.description.substring(0, 80) + "..."
                  : provider.description}
              </div>
            )}
            {provider.site && (
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
                className="text-blue-500 dark:text-cyan text-sm mt-2"
              >
                Visit Site
              </a>
            )}
          </div>
          )}
        </div>
      )}
    </div>
  );
};

export default HeaderSearch;