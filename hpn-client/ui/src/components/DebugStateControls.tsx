import React, { useState } from 'react';
import { OnboardingCheckDetails, IdentityStatus as TIdentityStatus, DelegationStatus as TDelegationStatus, FundingStatusDetails as TFundingStatusDetails } from '../logic/types';

interface DebugStateControlsProps {
    currentChecks: Partial<OnboardingCheckDetails>; // Use partial for easier updates
    onUpdateChecks: (newChecks: Partial<OnboardingCheckDetails>) => void;
}

const DebugStateControls: React.FC<DebugStateControlsProps> = ({ currentChecks, onUpdateChecks }) => {

    const handleCheckboxChange = (field: keyof OnboardingCheckDetails, isDetailedStatus?: boolean) => {
        if (isDetailedStatus) {
            // For detailed status fields, we might clear them or set to a default error/unknown state
            // This example simply toggles the main boolean flag for simplicity here
            const booleanField = field.replace("Status", "Configured") as keyof OnboardingCheckDetails; // e.g. identityStatus -> identityConfigured
            if (booleanField in currentChecks) {
                 onUpdateChecks({ [booleanField]: !currentChecks[booleanField] });
            }
            // To truly set a detailed status, we'd need more complex controls (dropdowns for enums)
        } else {
            onUpdateChecks({ [field]: !currentChecks[field] });
        }
    };

    const handleDetailedStatusChange = (
        field: 'identityStatus' | 'delegationStatus',
        valueKey: string,
        // Optional extra data for complex types
        data1?: string,
        data2?: string
    ) => {
        let actualStatus: TIdentityStatus | TDelegationStatus | null = null;

        if (field === 'identityStatus') {
            switch (valueKey) {
                case 'verified': actualStatus = { type: 'verified', entryName: data1 || 'mock.entry', tbaAddress: data2 || '0xmockTBA', ownerAddress: '0xmockOwner' }; break;
                case 'notFound': actualStatus = { type: 'notFound' }; break;
                case 'incorrectImplementation': actualStatus = { type: 'incorrectImplementation', found: data1 || '0xabc', expected: data2 || '0xdef' }; break;
                case 'implementationCheckFailed': actualStatus = { type: 'implementationCheckFailed', error: data1 || 'Simulated Impl Check Fail'}; break;
                case 'checkErrorIdentity': actualStatus = { type: 'checkError', error: data1 || 'Simulated Identity Check Error' }; break;
                default: actualStatus = null;
            }
        } else if (field === 'delegationStatus') {
            switch (valueKey) {
                case 'verified': actualStatus = 'verified'; break;
                case 'needsIdentity': actualStatus = 'needsIdentity'; break;
                case 'needsHotWallet': actualStatus = 'needsHotWallet'; break;
                case 'accessListNoteMissing': actualStatus = 'accessListNoteMissing'; break;
                case 'accessListNoteInvalidData': actualStatus = { type: 'accessListNoteInvalidData', reason: data1 || 'Simulated Bad AL Data' }; break;
                case 'signersNoteLookupError': actualStatus = { type: 'signersNoteLookupError', reason: data1 || 'Simulated Signers Lookup Error' }; break;
                case 'signersNoteMissing': actualStatus = 'signersNoteMissing'; break;
                case 'signersNoteInvalidData': actualStatus = { type: 'signersNoteInvalidData', reason: data1 || 'Simulated Bad Signers Data' }; break;
                case 'hotWalletNotInList': actualStatus = 'hotWalletNotInList'; break;
                case 'checkErrorDelegation': actualStatus = { type: 'checkError', error: data1 || 'Simulated Delegation Check Error' }; break;
                default: actualStatus = null;
            }
        }
        onUpdateChecks({ [field]: actualStatus });
    };

    // Logic to get current string key for dropdowns (more robust)
    const getCurrentStatusKey = (field: 'identityStatus' | 'delegationStatus'): string => {
        const status = currentChecks[field] as any;
        if (!status) return field === 'identityStatus' ? 'verified' : 'verified'; // Default
        if (typeof status === 'string') return status;
        if (typeof status === 'object' && status !== null) {
            // For object variants, we need a convention for the key in the dropdown
            // This example assumes the key is the variant name itself, or a unique string for variants with data
            if ('verified' in status) return 'verified';
            if ('notFound' in status) return 'notFound';
            if ('incorrectImplementation' in status) return 'incorrectImplementation';
            if ('implementationCheckFailed' in status) return 'implementationCheckFailed';
            if ('checkError' in status && field === 'identityStatus') return 'checkErrorIdentity';
            if ('accessListNoteInvalidData' in status) return 'accessListNoteInvalidData';
            if ('signersNoteLookupError' in status) return 'signersNoteLookupError';
            if ('signersNoteInvalidData' in status) return 'signersNoteInvalidData';
            if ('checkError' in status && field === 'delegationStatus') return 'checkErrorDelegation';
        }
        return field === 'identityStatus' ? 'verified' : 'verified'; // Fallback default
    };

    // State for conditional inputs for detailed statuses
    const [identityError, setIdentityError] = useState('');
    const [implFound, setImplFound] = useState('');
    const [implExpected, setImplExpected] = useState('');
    const [delegationReason, setDelegationReason] = useState('');

    const currentIdentityStatusKey = getCurrentStatusKey('identityStatus');
    const currentDelegationStatusKey = getCurrentStatusKey('delegationStatus');

    return (
        <div className="debug-controls" style={{ border: '1px dashed #ccc', padding: '15px', margin: '15px 0', background: '#f5f5f5' }}>
            <h4>Debug State Controls (Simulated)</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px' }}>
                {/* Identity Controls */}
                <fieldset>
                    <legend>Identity</legend>
                    <label>
                        <input 
                            type="checkbox" 
                            checked={!!currentChecks.identityConfigured}
                            onChange={() => onUpdateChecks({ identityConfigured: !currentChecks.identityConfigured })}
                        />
                        Identity Configured (Overall Boolean)
                    </label>
                    <br/>
                    <label>
                        Operator TBA: 
                        <input 
                            type="text" 
                            value={currentChecks.operatorTba || ''}
                            placeholder="0xOperatorTBA" 
                            onChange={(e) => onUpdateChecks({ operatorTba: e.target.value as `0x${string}` || null })}
                        />
                    </label>
                    <br/>
                    <label>Identity Status: </label>
                    <select 
                        value={currentIdentityStatusKey} 
                        onChange={(e) => {
                            const val = e.target.value;
                            // For variants needing data, use current local state or prompt, then call handle.
                            if (val === 'incorrectImplementation') handleDetailedStatusChange('identityStatus', val, implFound, implExpected);
                            else if (val === 'implementationCheckFailed' || val === 'checkErrorIdentity') handleDetailedStatusChange('identityStatus', val, identityError);
                            else handleDetailedStatusChange('identityStatus', val);
                        }}
                    >
                        <option value="verified">Verified (entry,tba,owner)</option>
                        <option value="notFound">Not Found</option>
                        <option value="incorrectImplementation">Incorrect Impl (found,expected)</option>
                        <option value="implementationCheckFailed">Impl. Check Fail (err)</option>
                        <option value="checkErrorIdentity">Check Error (err)</option>
                    </select>
                    {/* Conditional inputs for IdentityStatus data */}
                    {(currentIdentityStatusKey === 'incorrectImplementation') && (
                        <><input type="text" placeholder="Found Impl" value={implFound} onChange={e => setImplFound(e.target.value)} /> <input type="text" placeholder="Expected Impl" value={implExpected} onChange={e => setImplExpected(e.target.value)} /></>                     
                    )}
                    {(currentIdentityStatusKey === 'implementationCheckFailed' || currentIdentityStatusKey === 'checkErrorIdentity') && (
                        <input type="text" placeholder="Error Message" value={identityError} onChange={e => setIdentityError(e.target.value)} />
                    )}
                </fieldset>

                {/* Hot Wallet Controls */}
                <fieldset>
                    <legend>Hot Wallet</legend>
                    <label>
                        <input 
                            type="checkbox" 
                            checked={!!currentChecks.hotWalletSelectedAndActive}
                            onChange={() => onUpdateChecks({ hotWalletSelectedAndActive: !currentChecks.hotWalletSelectedAndActive })}
                        />
                        Selected & Active
                    </label>
                    <br/>
                    <label>
                        Hot Wallet Address: 
                        <input 
                            type="text" 
                            value={currentChecks.hotWalletAddress || ''} 
                            placeholder="0xHotWalletAddress"
                            onChange={(e) => onUpdateChecks({ hotWalletAddress: e.target.value || null })}
                        />
                    </label>
                </fieldset>

                {/* Delegation Controls */}
                <fieldset>
                    <legend>Delegation</legend>
                    <label>
                        <input 
                            type="checkbox" 
                            checked={currentChecks.delegationVerified === true} // Handle null/undefined for initial state
                            onChange={() => onUpdateChecks({ delegationVerified: !(currentChecks.delegationVerified === true) })}
                        />
                        Delegation Verified (Overall Boolean)
                    </label>
                    <br/>
                    <label>Delegation Status: </label>
                    <select 
                        value={currentDelegationStatusKey} 
                        onChange={(e) => {
                            const val = e.target.value;
                            if (val === 'accessListNoteInvalidData' || val === 'signersNoteLookupError' || val === 'signersNoteInvalidData' || val === 'checkErrorDelegation') {
                                handleDetailedStatusChange('delegationStatus', val, delegationReason);
                            } else {
                                handleDetailedStatusChange('delegationStatus', val);
                            }
                        }}
                    >
                        <option value="verified">Verified</option>
                        <option value="needsIdentity">Needs Identity</option>
                        <option value="needsHotWallet">Needs Hot Wallet</option>
                        <option value="accessListNoteMissing">Access List Missing</option>
                        <option value="accessListNoteInvalidData">Access List Invalid Data (reason)</option>
                        <option value="signersNoteLookupError">Signers Lookup Err (reason)</option>
                        <option value="signersNoteMissing">Signers Note Missing</option>
                        <option value="signersNoteInvalidData">Signers Note Invalid Data (reason)</option>
                        <option value="hotWalletNotInList">Hot Wallet Not In List</option>
                        <option value="checkErrorDelegation">Check Error (reason)</option>
                    </select>
                    {(currentDelegationStatusKey.includes('InvalidData') || currentDelegationStatusKey.includes('Error')) && (
                        <input type="text" placeholder="Reason/Error" value={delegationReason} onChange={e => setDelegationReason(e.target.value)} />
                    )}
                </fieldset>
                
                {/* Funding Controls */}
                <fieldset>
                    <legend>Funding</legend>
                    <label><input type="checkbox" checked={currentChecks.fundingStatus?.tbaNeedsEth ?? true} onChange={e => onUpdateChecks({ fundingStatus: { ...currentChecks.fundingStatus, tbaNeedsEth: e.target.checked } as TFundingStatusDetails })}/> TBA Needs ETH</label>
                    <label><input type="checkbox" checked={currentChecks.fundingStatus?.tbaNeedsUsdc ?? true} onChange={e => onUpdateChecks({ fundingStatus: { ...currentChecks.fundingStatus, tbaNeedsUsdc: e.target.checked } as TFundingStatusDetails })}/> TBA Needs USDC</label>
                    <label><input type="checkbox" checked={currentChecks.fundingStatus?.hotWalletNeedsEth ?? true} onChange={e => onUpdateChecks({ fundingStatus: { ...currentChecks.fundingStatus, hotWalletNeedsEth: e.target.checked } as TFundingStatusDetails })}/> HotWallet Needs ETH</label>
                    <br/>
                    <label>Funding Check Error: <input type="text" value={currentChecks.fundingStatus?.checkError || ''} onChange={e => onUpdateChecks({ fundingStatus: { ...currentChecks.fundingStatus, checkError: e.target.value || null } as TFundingStatusDetails })} placeholder="Error message"/></label>
                </fieldset>
            </div>
        </div>
    );
};

export default DebugStateControls; 