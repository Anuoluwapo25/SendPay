// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title UsernameRegistry
/// @notice Globally unique `a-z` + `0-9` usernames (3–32 chars), one per address.
contract UsernameRegistry {
    uint256 public constant MIN_LENGTH = 3;
    uint256 public constant MAX_LENGTH = 32;

    mapping(bytes32 nameHash => address owner) public nameToOwner;
    mapping(address owner => bytes32 nameHash) public ownerToName;

    event NameRegistered(address indexed owner, bytes32 indexed nameHash, string name);

    error NameTaken();
    error AlreadyRegistered();
    error InvalidName();

    /// @notice Register a username for `msg.sender`. Each address can hold at most one name.
    function register(string calldata name) external {
        if (ownerToName[msg.sender] != bytes32(0)) revert AlreadyRegistered();
        bytes32 h = _requireValidNameHash(name);
        if (nameToOwner[h] != address(0)) revert NameTaken();
        nameToOwner[h] = msg.sender;
        ownerToName[msg.sender] = h;
        emit NameRegistered(msg.sender, h, name);
    }

    /// @return The wallet linked to `name`, or `address(0)` if unclaimed or invalid format.
    function getAddressByName(string calldata name) external view returns (address) {
        (bool ok, bytes32 h) = _tryNameHash(name);
        if (!ok) return address(0);
        return nameToOwner[h];
    }

    function getNameHashByAddress(address user) external view returns (bytes32) {
        return ownerToName[user];
    }

    function _requireValidNameHash(string calldata name) internal pure returns (bytes32) {
        (bool ok, bytes32 h) = _tryNameHash(name);
        if (!ok) revert InvalidName();
        return h;
    }

    function _tryNameHash(string calldata name) internal pure returns (bool ok, bytes32 h) {
        bytes memory b = bytes(name);
        uint256 len = b.length;
        if (len < MIN_LENGTH || len > MAX_LENGTH) return (false, bytes32(0));
        for (uint256 i = 0; i < len; i++) {
            uint8 c = uint8(b[i]);
            bool lower = c >= 97 && c <= 122;
            bool digit = c >= 48 && c <= 57;
            if (!lower && !digit) return (false, bytes32(0));
        }
        return (true, keccak256(b));
    }
}
