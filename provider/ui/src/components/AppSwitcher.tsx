import classNames from 'classnames';
import React, { useRef } from 'react';
import { PUBLISHER } from '../constants';

interface AppSwitcherProps {
  currentApp?: 'operator' | 'provider';
}

const AppSwitcher: React.FC<AppSwitcherProps> = ({ currentApp = 'operator' }) => {
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleSwitch = (app: 'operator' | 'provider') => {
    console.log(`Switching to ${app} mode, current origin: ${window.location.origin}, current app: ${currentApp}`);
    if (app === currentApp) {
      return;
    }

    // Use the current origin and construct the URL dynamically
    const origin = window.location.origin;
    const url = app === 'operator'
      ? `${origin}/operator:hypergrid:${PUBLISHER}/`
      : `${origin}/provider:hypergrid:${PUBLISHER}/`;

    window.location.href = url;
  };

  return (
    <div
      className="relative mt-auto flex flex-col gap-4 min-w-3/4 self-center"
      ref={dropdownRef}
    >
      <div className="border-t border-gray-300 dark:border-white w-16 h-4 border-t-2"></div>
      <h3 className="font-semibold  text-xl">Switch mode</h3>
      <button
        onClick={() => handleSwitch('provider')}
        className={classNames("text-xl self-stretch hover:underline !justify-start", {
          'font-bold underline': currentApp === 'provider'
        })}
      >
        <span className={classNames("h-12 rounded-2xl flex place-items-center place-content-center aspect-square p-3", {
          'text-black dark:text-white bg-gray dark:bg-dark-gray': currentApp !== 'provider',
          'text-cyan dark:text-black bg-black dark:bg-cyan': currentApp === 'provider',
        })} >
          <img
            src={`${import.meta.env.BASE_URL}/provider.svg`}
            alt="Provider"
            className="w-full h-full object-contain"
          />
        </span>
        <span>
          Provider mode
        </span>
      </button>
      <button
        onClick={() => handleSwitch('operator')}
        className={classNames("text-xl self-stretch hover:underline !justify-start", {
          'font-bold underline': currentApp === 'operator'
        })}
      >
        <span className={classNames("h-12 rounded-2xl flex place-items-center place-content-center aspect-square p-3", {
          'text-black bg-gray dark:bg-dark-gray': currentApp !== 'operator',
          'text-cyan bg-black': currentApp === 'operator',
        })} >
          <img
            src={`${import.meta.env.BASE_URL}/operator.svg`}
            alt="Operator"
            className="w-full h-full object-contain"
          />
        </span>
        <span>
          Operator mode
        </span>
      </button>
    </div>
  );
};

export default AppSwitcher;
