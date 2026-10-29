// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title FacturaLedger
/// @notice Public book of cross-border invoices that clients settle over x402.
///
/// The ledger never holds funds. It records each invoice, the x402 settlement that paid
/// it, and every payout the Factura agent forwards afterwards. A payout can only ever be
/// sent to the freelancer who issued the invoice: the agent picks the token and amount
/// (USD₮, wBRL, ...), the contract picks the destination.
contract FacturaLedger is Ownable2Step {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Open,
        Paid,
        Cancelled
    }

    struct Invoice {
        address freelancer;
        address asset; // token the client pays in, e.g. USA₮
        uint256 amount; // in `asset` atomic units
        uint64 dueAt;
        uint64 paidAt;
        Status status;
        address payer;
        bytes32 settlementTx; // x402 settlement transaction on Celo
        bytes32 metaHash; // keccak256 of the off-chain invoice document
    }

    mapping(bytes32 id => Invoice) private _invoices;
    mapping(bytes32 id => mapping(address token => uint256)) public paidOut;
    mapping(address => bool) public operators;

    event OperatorSet(address indexed operator, bool allowed);
    event InvoiceCreated(
        bytes32 indexed id,
        address indexed freelancer,
        address asset,
        uint256 amount,
        uint64 dueAt,
        bytes32 metaHash
    );
    event InvoiceCancelled(bytes32 indexed id, address indexed by);
    event InvoicePaid(bytes32 indexed id, address indexed payer, bytes32 settlementTx);
    event Converted(
        bytes32 indexed id,
        address sellToken,
        uint256 sellAmount,
        address buyToken,
        uint256 buyAmount,
        bytes32 swapTx
    );
    event PayoutSent(bytes32 indexed id, address indexed freelancer, address token, uint256 amount);

    error NotAuthorized();
    error InvoiceExists();
    error InvalidInvoice();
    error WrongStatus(Status current);

    modifier onlyOperator() {
        if (!operators[msg.sender]) revert NotAuthorized();
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setOperator(address operator, bool allowed) external onlyOwner {
        operators[operator] = allowed;
        emit OperatorSet(operator, allowed);
    }

    /// @notice Open an invoice. Callable by the freelancer, or by an operator acting on
    /// the freelancer's request (the agent creates invoices from chat).
    function createInvoice(
        bytes32 id,
        address freelancer,
        address asset,
        uint256 amount,
        uint64 dueAt,
        bytes32 metaHash
    ) external {
        if (msg.sender != freelancer && !operators[msg.sender]) revert NotAuthorized();
        if (freelancer == address(0) || asset == address(0) || amount == 0) revert InvalidInvoice();
        if (_invoices[id].status != Status.None) revert InvoiceExists();

        _invoices[id] = Invoice({
            freelancer: freelancer,
            asset: asset,
            amount: amount,
            dueAt: dueAt,
            paidAt: 0,
            status: Status.Open,
            payer: address(0),
            settlementTx: bytes32(0),
            metaHash: metaHash
        });
        emit InvoiceCreated(id, freelancer, asset, amount, dueAt, metaHash);
    }

    function cancelInvoice(bytes32 id) external {
        Invoice storage inv = _invoices[id];
        if (msg.sender != inv.freelancer && !operators[msg.sender]) revert NotAuthorized();
        if (inv.status != Status.Open) revert WrongStatus(inv.status);
        inv.status = Status.Cancelled;
        emit InvoiceCancelled(id, msg.sender);
    }

    /// @notice Record the x402 settlement that paid an open invoice.
    function markPaid(bytes32 id, address payer, bytes32 settlementTx) external onlyOperator {
        Invoice storage inv = _invoices[id];
        if (inv.status != Status.Open) revert WrongStatus(inv.status);
        inv.status = Status.Paid;
        inv.paidAt = uint64(block.timestamp);
        inv.payer = payer;
        inv.settlementTx = settlementTx;
        emit InvoicePaid(id, payer, settlementTx);
    }

    /// @notice Audit trail for an FX conversion the agent ran on the invoice's proceeds.
    function recordConversion(
        bytes32 id,
        address sellToken,
        uint256 sellAmount,
        address buyToken,
        uint256 buyAmount,
        bytes32 swapTx
    ) external onlyOperator {
        if (_invoices[id].status != Status.Paid) revert WrongStatus(_invoices[id].status);
        emit Converted(id, sellToken, sellAmount, buyToken, buyAmount, swapTx);
    }

    /// @notice Forward invoice proceeds to the freelancer. Pulls `amount` of `token` from
    /// the calling operator, so the operator must have approved this contract.
    function payout(bytes32 id, address token, uint256 amount) external onlyOperator {
        Invoice storage inv = _invoices[id];
        if (inv.status != Status.Paid) revert WrongStatus(inv.status);
        paidOut[id][token] += amount;
        IERC20(token).safeTransferFrom(msg.sender, inv.freelancer, amount);
        emit PayoutSent(id, inv.freelancer, token, amount);
    }

    function getInvoice(bytes32 id) external view returns (Invoice memory) {
        return _invoices[id];
    }
}
