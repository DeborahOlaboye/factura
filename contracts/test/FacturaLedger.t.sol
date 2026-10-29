// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {FacturaLedger} from "../src/FacturaLedger.sol";

contract MockToken is ERC20 {
    uint8 private immutable _dec;

    constructor(string memory symbol, uint8 dec) ERC20(symbol, symbol) {
        _dec = dec;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract FacturaLedgerTest is Test {
    FacturaLedger ledger;
    MockToken usat;
    MockToken wbrl;

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address freelancer = makeAddr("freelancer");
    address client = makeAddr("client");
    address stranger = makeAddr("stranger");

    bytes32 constant ID = keccak256("inv-001");
    bytes32 constant META = keccak256("invoice json");
    bytes32 constant SETTLE_TX = keccak256("settlement");

    function setUp() public {
        ledger = new FacturaLedger(owner);
        usat = new MockToken("USAT", 6);
        wbrl = new MockToken("wBRL", 18);
        vm.prank(owner);
        ledger.setOperator(agent, true);
    }

    function _open() internal {
        vm.prank(freelancer);
        ledger.createInvoice(ID, freelancer, address(usat), 1_200e6, uint64(block.timestamp + 15 days), META);
    }

    function test_freelancerCreatesInvoice() public {
        _open();
        FacturaLedger.Invoice memory inv = ledger.getInvoice(ID);
        assertEq(inv.freelancer, freelancer);
        assertEq(inv.amount, 1_200e6);
        assertEq(uint8(inv.status), uint8(FacturaLedger.Status.Open));
        assertEq(inv.metaHash, META);
    }

    function test_operatorCreatesOnBehalfOfFreelancer() public {
        vm.prank(agent);
        ledger.createInvoice(ID, freelancer, address(usat), 500e6, 0, META);
        assertEq(ledger.getInvoice(ID).freelancer, freelancer);
    }

    function test_strangerCannotCreateForSomeoneElse() public {
        vm.prank(stranger);
        vm.expectRevert(FacturaLedger.NotAuthorized.selector);
        ledger.createInvoice(ID, freelancer, address(usat), 500e6, 0, META);
    }

    function test_rejectsDuplicateId() public {
        _open();
        vm.prank(freelancer);
        vm.expectRevert(FacturaLedger.InvoiceExists.selector);
        ledger.createInvoice(ID, freelancer, address(usat), 1e6, 0, META);
    }

    function test_rejectsZeroAmount() public {
        vm.prank(freelancer);
        vm.expectRevert(FacturaLedger.InvalidInvoice.selector);
        ledger.createInvoice(ID, freelancer, address(usat), 0, 0, META);
    }

    function test_markPaidRecordsSettlement() public {
        _open();
        vm.prank(agent);
        ledger.markPaid(ID, client, SETTLE_TX);
        FacturaLedger.Invoice memory inv = ledger.getInvoice(ID);
        assertEq(uint8(inv.status), uint8(FacturaLedger.Status.Paid));
        assertEq(inv.payer, client);
        assertEq(inv.settlementTx, SETTLE_TX);
        assertEq(inv.paidAt, block.timestamp);
    }

    function test_onlyOperatorMarksPaid() public {
        _open();
        vm.prank(freelancer);
        vm.expectRevert(FacturaLedger.NotAuthorized.selector);
        ledger.markPaid(ID, client, SETTLE_TX);
    }

    function test_cannotPayTwice() public {
        _open();
        vm.startPrank(agent);
        ledger.markPaid(ID, client, SETTLE_TX);
        vm.expectRevert(abi.encodeWithSelector(FacturaLedger.WrongStatus.selector, FacturaLedger.Status.Paid));
        ledger.markPaid(ID, client, SETTLE_TX);
        vm.stopPrank();
    }

    function test_payoutAlwaysGoesToFreelancer() public {
        _open();
        wbrl.mint(agent, 3_000e18);
        vm.startPrank(agent);
        ledger.markPaid(ID, client, SETTLE_TX);
        wbrl.approve(address(ledger), type(uint256).max);
        ledger.payout(ID, address(wbrl), 3_000e18);
        vm.stopPrank();

        assertEq(wbrl.balanceOf(freelancer), 3_000e18);
        assertEq(wbrl.balanceOf(agent), 0);
        assertEq(ledger.paidOut(ID, address(wbrl)), 3_000e18);
    }

    function test_splitPayoutAcrossTokens() public {
        _open();
        usat.mint(agent, 840e6);
        wbrl.mint(agent, 1_800e18);
        vm.startPrank(agent);
        ledger.markPaid(ID, client, SETTLE_TX);
        usat.approve(address(ledger), type(uint256).max);
        wbrl.approve(address(ledger), type(uint256).max);
        ledger.payout(ID, address(usat), 840e6);
        ledger.payout(ID, address(wbrl), 1_800e18);
        vm.stopPrank();

        assertEq(usat.balanceOf(freelancer), 840e6);
        assertEq(wbrl.balanceOf(freelancer), 1_800e18);
    }

    function test_payoutRequiresPaidInvoice() public {
        _open();
        wbrl.mint(agent, 1e18);
        vm.startPrank(agent);
        wbrl.approve(address(ledger), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(FacturaLedger.WrongStatus.selector, FacturaLedger.Status.Open));
        ledger.payout(ID, address(wbrl), 1e18);
        vm.stopPrank();
    }

    function test_freelancerCancelsOpenInvoice() public {
        _open();
        vm.prank(freelancer);
        ledger.cancelInvoice(ID);
        assertEq(uint8(ledger.getInvoice(ID).status), uint8(FacturaLedger.Status.Cancelled));
    }

    function test_cannotCancelPaidInvoice() public {
        _open();
        vm.prank(agent);
        ledger.markPaid(ID, client, SETTLE_TX);
        vm.prank(freelancer);
        vm.expectRevert(abi.encodeWithSelector(FacturaLedger.WrongStatus.selector, FacturaLedger.Status.Paid));
        ledger.cancelInvoice(ID);
    }

    function test_recordConversionEmits() public {
        _open();
        vm.startPrank(agent);
        ledger.markPaid(ID, client, SETTLE_TX);
        vm.expectEmit(true, false, false, true);
        emit FacturaLedger.Converted(ID, address(usat), 360e6, address(wbrl), 1_800e18, bytes32(uint256(1)));
        ledger.recordConversion(ID, address(usat), 360e6, address(wbrl), 1_800e18, bytes32(uint256(1)));
        vm.stopPrank();
    }

    function test_revokedOperatorLosesAccess() public {
        _open();
        vm.prank(owner);
        ledger.setOperator(agent, false);
        vm.prank(agent);
        vm.expectRevert(FacturaLedger.NotAuthorized.selector);
        ledger.markPaid(ID, client, SETTLE_TX);
    }
}
