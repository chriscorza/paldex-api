## ADDED Requirements

### Requirement: The ownership target of a tool call is a property of its API key

Every MCP API key SHALL carry an `owner_user_id`: the account whose books its tool calls read and write. The MCP endpoint SHALL resolve that owner once per request and pass it to the tools, and the tools SHALL stamp written rows with it. No tool SHALL accept an ownership target as an argument, so a tool call cannot aim a write at an account other than the one its key is bound to.

A key whose `owner_user_id` is null SHALL be refused on any write with an error naming the key, rather than defaulting to the key's own user.

#### Scenario: A write lands in the key owner's books

- **WHEN** a key bound to user A invokes a writing tool successfully
- **THEN** the created row carries `user_id = A`
- **AND** it appears in A's listings and reports, not in the key's own user's

#### Scenario: A key without an owner cannot write

- **WHEN** a key whose `owner_user_id` is null invokes a writing tool
- **THEN** the call fails with an error that names the key and the missing field
- **AND** nothing is written

#### Scenario: A tool cannot be told to write into another account

- **WHEN** an MCP client inspects the input schema of any writing tool
- **THEN** there is no argument that sets the owning user
- **AND** the ownership target is taken solely from the key

#### Scenario: Reads use the same ownership target

- **WHEN** a key bound to user A invokes a read tool under `OWN` scope
- **THEN** the results are A's data

### Requirement: Each MCP tool call is auditable

The MCP endpoint SHALL emit one structured log entry per tool call containing the tool name, the key id, the caller's user id, the effective owner's user id, the outcome and the id of the row created when the call wrote one.

#### Scenario: A write can be traced to its credential

- **WHEN** a writing tool succeeds
- **THEN** a log entry exists that ties the created row id to the key id and to the owner the row was written for
