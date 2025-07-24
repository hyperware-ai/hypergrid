import React, { useState, useEffect } from 'react';
import { Address } from 'viem';
import { useApprovePaymaster, CIRCLE_PAYMASTER_ADDRESS, USDC_ADDRESS_BASE, DEFAULT_PAYMASTER_APPROVAL_AMOUNT } from '../logic/hypermapHelpers';

interface PaymasterApprovalButtonProps {
    operatorTbaAddress: Address;
    onApprovalComplete?: () => void;
    className?: string;
    disabled?: boolean;
}

const PaymasterApprovalButton: React.FC<PaymasterApprovalButtonProps> = ({
    operatorTbaAddress,
    onApprovalComplete,
    className,
    disabled = false
}) => {
    const [showConfirmation, setShowConfirmation] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);

    const {
        approvePaymaster,
        transactionHash,
        isSending,
        isConfirming,
        isConfirmed,
        error,
        reset
    } = useApprovePaymaster({
        onSuccess: (data) => {
            console.log("Paymaster approval transaction sent:", data);
            setLocalError(null);
        },
        onError: (err) => {
            console.error("Paymaster approval error:", err);
            setLocalError(err.message || "Failed to approve paymaster!");
        },
        onSettled: (data, error) => {
            if (!error && data) {
                console.log("Paymaster approval settled successfully");
            }
        }
    });

    useEffect(() => {
        if (isConfirmed && onApprovalComplete) {
            console.log("Paymaster approval confirmed, calling onApprovalComplete with delay");
            setShowConfirmation(false);
            // Add delay to allow backend to sync with blockchain state
            setTimeout(() => {
                onApprovalComplete();
                reset();
            }, 2000);
        }
    }, [isConfirmed, onApprovalComplete, reset]);

    const handleApprove = () => {
        if (!operatorTbaAddress) {
            setLocalError("No operator TBA address provided");
            return;
        }

        console.log("Initiating paymaster approval for TBA:", operatorTbaAddress);
        setLocalError(null);
        
        approvePaymaster({
            operatorTbaAddress,
            paymasterAddress: CIRCLE_PAYMASTER_ADDRESS,
            usdcAddress: USDC_ADDRESS_BASE,
            approvalAmount: DEFAULT_PAYMASTER_APPROVAL_AMOUNT,
        });
    };

    const handleButtonClick = () => {
        if (showConfirmation) {
            handleApprove();
        } else {
            setShowConfirmation(true);
        }
    };

    const handleCancel = () => {
        setShowConfirmation(false);
        setLocalError(null);
    };

    const isProcessing = isSending || isConfirming;
    const buttonDisabled = disabled || isProcessing;

    // Format the approval amount for display (1M USDC)
    const approvalAmountDisplay = "1,000,000 USDC";

    return (
        <div className={className}>
            {!showConfirmation ? (
                <button
                    onClick={handleButtonClick}
                    disabled={buttonDisabled}
                    style={{
                        padding: '8px 16px',
                        backgroundColor: buttonDisabled ? '#555' : '#28a745',
                        color: buttonDisabled ? '#888' : 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: buttonDisabled ? 'not-allowed' : 'pointer',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        width: '100%',
                    }}
                >
                    {isProcessing ? 'Processing...' : 'Enable USDC Gas Transactions'}
                </button>
            ) : (
                <div style={{ 
                    padding: '12px', 
                    backgroundColor: '#f8f9fa', 
                    borderRadius: '4px',
                    border: '1px solid #dee2e6'
                }}>
                    <p style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#333' }}>
                        <strong>Approve Paymaster?</strong>
                    </p>
                    <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#666' }}>
                        This will allow Circle's paymaster to spend up to {approvalAmountDisplay} from this TBA for gas fees, enabling gasless transactions.
                    </p>
                    <p style={{ margin: '0 0 8px 0', fontSize: '11px', color: '#888' }}>
                        Paymaster: {CIRCLE_PAYMASTER_ADDRESS.slice(0, 6)}...{CIRCLE_PAYMASTER_ADDRESS.slice(-4)}
                    </p>
                    <p style={{ margin: '0 0 12px 0', fontSize: '11px', color: '#888', fontStyle: 'italic' }}>
                        ⚠️ Important: This is a one-time setup required for gasless functionality. Once approved, you can sign transactions without needing ETH for gas.
                    </p>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            onClick={handleApprove}
                            disabled={isProcessing}
                            style={{
                                flex: 1,
                                padding: '6px 12px',
                                backgroundColor: isProcessing ? '#555' : '#28a745',
                                color: isProcessing ? '#888' : 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: isProcessing ? 'not-allowed' : 'pointer',
                                fontSize: '13px',
                            }}
                        >
                            {isProcessing ? 'Processing...' : 'Confirm'}
                        </button>
                        <button
                            onClick={handleCancel}
                            disabled={isProcessing}
                            style={{
                                flex: 1,
                                padding: '6px 12px',
                                backgroundColor: '#6c757d',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: isProcessing ? 'not-allowed' : 'pointer',
                                fontSize: '13px',
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Status messages */}
            {isSending && (
                <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#ffc107' }}>
                    Sending approval transaction...
                </p>
            )}
            {isConfirming && transactionHash && (
                <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#17a2b8' }}>
                    Confirming transaction: {transactionHash.slice(0, 10)}...
                </p>
            )}
            {isConfirmed && (
                <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#28a745' }}>
                    ✓ Paymaster approved successfully!
                </p>
            )}
            {(localError || error) && (
                <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#dc3545' }}>
                    Error: {localError || error?.message}
                </p>
            )}
        </div>
    );
};

export default PaymasterApprovalButton; 