# Workflow Definition Specification for OpenAPI 2.0

**Version:** 1.0  
**Date:** November 25, 2025  
**Status:** Draft  
**Author:** Elmer Nocon

---

## Quick Navigation

### Core Documentation
- **[Overview & Concepts](#1-overview)** - Sections 1-2: Purpose, design principles, workflow structure
- **[Schema Structure](#3-schema-structure)** - Section 3: Root object, source descriptions, workflow properties
- **[Steps & Operations](#5-steps)** - Section 5: Step schema, operation selection, auth, dependencies
- **[Data Flow](#6-step-inputs)** - Sections 6-8: Step inputs, outputs, workflow outputs
- **[Workflow Composition](#9-workflow-references)** - Section 9: WorkflowRef, output mapping, deprecation

### Validation & Troubleshooting
- **[Validation Rules Matrix](#110-validation-summary-matrix)** - Section 11.0: **START HERE for errors** - Quick reference table
- **[Schema Validation](#111-schema-level-validation)** - Section 11.1: JSON Schema enforced rules
- **[Runtime Validation](#112-runtime-pre-execution-validation)** - Section 11.2: Pre-execution checks
- **[Best Practices](#12-best-practices)** - Section 12: Naming, error handling, security tips

### Reference & Examples
- **[Complete Examples](#10-complete-examples)** - Section 10: OAuth flows, onboarding, composition, edge cases
- **[Security](#16-security-considerations)** - Section 16: Sensitive data, auth handling, injection prevention
- **[OpenAPI Integration](#13-integration-with-openapi-20)** - Section 13: Operation resolution, parameter mapping
- **[Glossary](#18-glossary)** - Section 18: Term definitions

### Common Questions
- **"How do I...?"** → See examples in [Section 10](#10-complete-examples)
- **"What's the validation rule?"** → [Section 11.0 Matrix](#110-validation-summary-matrix)
- **"My workflow failed validation"** → [Section 11](#11-validation-rules) (check layer: Schema → Runtime Pre → Runtime Exec)
- **"Is this syntax allowed?"** → Check relevant section + [Section 11](#11-validation-rules)
- **"How do I handle sensitive data?"** → [Section 16.1](#161-sensitive-data)
- **"Multi-API setup?"** → [Section 3.2](#32-source-descriptions-multi-api-support)

---

## 1. Overview

This specification defines a standardized format for creating orchestrated workflows that compose multiple OpenAPI 2.0 (Swagger) operations into reusable, executable sequences. Workflows enable complex multi-step processes by chaining API operations together with data flow management, dependency control, and parameter transformation.

### 1.1 Purpose

The Workflow Definition format allows developers to:

- **Compose API Operations**: Chain multiple OpenAPI operations into cohesive workflows
- **Manage Data Flow**: Pass outputs from one step as inputs to subsequent steps
- **Define Dependencies**: Control execution order through explicit dependency declarations
- **Reuse Logic**: Create modular workflows that reference other workflows
- **Parameterize Behavior**: Accept runtime inputs to customize workflow execution
- **Handle OAuth Flows**: Capture redirect parameters and response data systematically

### 1.2 Design Principles

1. **Declarative**: Workflows are defined as data structures, not imperative code
2. **Composable**: Workflows can reference and reuse other workflows
3. **Explicit**: All dependencies, inputs, and outputs are clearly declared
4. **Typed**: JSON Schema validation ensures correctness
5. **OpenAPI-Native**: Directly references OpenAPI operations via operationId or method/path pairs

## 2. Core Concepts

### 2.1 Workflow Structure

A workflow is a named, ordered sequence of steps that execute API operations. Each workflow may:

- Accept input parameters from callers
- Execute one or more steps sequentially or with controlled parallelism
- Produce named outputs for consumers
- Reference other workflows for composition

### 2.2 Steps

Steps are the atomic units of workflow execution. Each step:

- Has a unique identifier within the workflow
- Executes exactly one operation (OpenAPI operation, HTTP request, or nested workflow)
- May depend on other steps completing first
- Accepts inputs (literals or references to other data)
- Produces outputs that subsequent steps can consume

### 2.3 Data Flow

Data flows through workflows via:

- **Workflow Inputs**: Parameters provided by the workflow caller
- **Step Outputs**: Data captured from step execution (response bodies, headers, status codes, redirect parameters)
- **Input References**: Pointers that connect outputs from previous steps to inputs of subsequent steps
- **Transformations**: JSONPath expressions that extract or reshape data

## 3. Schema Structure

### 3.1 Root Object

The root object contains workflow definitions, required version information, and optional API source registrations:

```yaml
schemaVersion: '1.0'

sourceDescriptions:
  - name: user-api
    url: https://api.example.com/users/openapi.yaml
    description: 'User management API'
  - name: order-api
    url: https://api.example.com/orders/openapi.yaml
    description: 'Order processing API'

workflows:
  checkout:
    name: 'Checkout Process'
    description: 'Multi-service checkout orchestration'
    steps:
      - id: get-user
        operationId: user-api.getUserById
        inputs:
          userId: { from: workflow/userId }
      
      - id: create-order
        operationId: order-api.createOrder
        dependencies: [ step/get-user ]
        inputs:
          userId: { from: step/get-user, output: userId }
```

**Properties:**
- `schemaVersion` (string, **required**): Version of the workflow schema specification. Must be '1.0' for workflows conforming to this specification version. This field is mandatory to ensure explicit version declaration, enable proper tooling compatibility, support schema validation, and facilitate future migration paths. Tooling must reject workflows with unsupported or missing version declarations.
- `sourceDescriptions` (array, **required**): Global registry of OpenAPI specifications available to all workflows. Must contain at least one source description specifying which API(s) the workflows will interact with. Even single-API workflows must declare their source. See [Section 3.2](#32-source-descriptions-multi-api-support) for details.
- `workflows` (object, **required**): Map of workflow identifiers to Workflow definitions

### 3.2 Source Descriptions (Multi-API Support)

Source descriptions provide a **required** central registry of OpenAPI specifications that workflows reference. Every workflow document must declare at least one source description to specify which API(s) it interacts with. This design enables both single-API and multi-API orchestration scenarios.

**Why Required?**
- Workflow engines need to know which OpenAPI specification(s) to load
- Makes workflow documents self-contained and explicit
- Eliminates ambiguity about which API operations reference
- Enables multi-API orchestration when multiple sources are defined

#### 3.2.1 Single API vs Multi-API

**Single API:**

```yaml
schemaVersion: '1.0'

sourceDescriptions:
  - name: user-api
    url: https://api.example.com/users/openapi.yaml
    description: 'User management API'

workflows:
  user-workflow:
    steps:
      - id: get-user
        operationId: getUserById  # Unqualified - only one source
        inputs:
          userId: { const: '12345' }
```

**Multi-API:**

Define multiple APIs at the root level, then use qualified references:

```yaml
schemaVersion: '1.0'

sourceDescriptions:
  - name: user-service
    url: https://api.example.com/users/openapi.yaml
    description: 'User management and authentication'
  
  - name: billing-service
    url: https://api.example.com/billing/openapi.yaml
    description: 'Billing and payment processing'

workflows:
  user-billing-workflow:
    steps:
      - id: get-user
        operationId: user-service.getUserById
        inputs:
          userId: { const: '12345' }
      
      - id: get-invoice
        operationId: billing-service.getInvoice
        dependencies: [ step/get-user ]
        inputs:
          customerId: { from: step/get-user, output: customerId }
```

#### 3.2.2 SourceDescription Properties

| Property      | Type   | Required | Description                                              |
|---------------|--------|----------|----------------------------------------------------------|
| `name`        | string | **Yes**  | Unique identifier for the API source (namespace prefix)  |
| `url`         | string | **Yes**  | URL or file path to the OpenAPI specification            |
| `description` | string | No       | Human-readable description of the API source             |

**Name Requirements:**
- Must be unique across all source descriptions in the document
- Pattern: `^[a-zA-Z0-9_-]+$`
- Used as namespace prefix in qualified references: `name.operationId`

**URL Formats:**
- HTTP(S) URLs: `https://api.example.com/openapi.yaml`
- Relative file paths: `./specs/api.json`, `../shared/billing-api.yaml`
- Absolute file paths: `/path/to/spec.yaml`

#### 3.2.3 Qualified Operation References

When **multiple** `sourceDescriptions` are defined, use qualified notation to explicitly specify which API contains the operation:

```yaml
sourceDescriptions:
  - name: user-api
    url: https://users.example.com/openapi.yaml
  - name: product-api
    url: https://products.example.com/openapi.yaml

workflows:
  product-recommendation:
    steps:
      # Qualified operationId - explicitly targets user-api
      - id: get-user
        operationId: user-api.getUserById
        inputs:
          userId: { const: '12345' }
      
      # Qualified operationId - explicitly targets product-api
      - id: get-recommendations
        operationId: product-api.getRecommendations
        dependencies: [ step/get-user ]
        inputs:
          userId: { from: step/get-user, output: userId }
```

**Format:** `source-name.operationId`
- `source-name` must match a `name` in `sourceDescriptions`
- `operationId` must exist in that API's OpenAPI specification

#### 3.2.4 Method + Path with Multiple APIs

When using `method` + `path`, add the `source` property to specify which API:

```yaml
sourceDescriptions:
  - name: user-api
    url: https://users.example.com/openapi.yaml
  - name: product-api
    url: https://products.example.com/openapi.yaml

workflows:
  catalog-workflow:
    steps:
      # Method+path with explicit source
      - id: get-user
        method: GET
        path: /users/{userId}
        source: user-api
        inputs:
          userId: { const: '12345' }
      
      # Method+path with different source
      - id: get-product
        method: GET
        path: /products/{productId}
        source: product-api
        inputs:
          productId: { const: 'prod-456' }
```

**When `source` is Required:**
- **Required**: When document has multiple `sourceDescriptions` and using `method`+`path`
- **Optional**: When document has only one `sourceDescription`

#### 3.2.5 Complete Multi-API Example

```yaml
schemaVersion: '1.0'

sourceDescriptions:
  - name: user-service
    url: https://api.example.com/users/v2/openapi.yaml
    description: 'User management and profiles'
  
  - name: inventory-service
    url: https://api.example.com/inventory/openapi.json
    description: 'Product inventory and stock management'
  
  - name: payment-service
    url: https://api.example.com/payments/openapi.yaml
    description: 'Payment processing and transactions'

workflows:
  e-commerce-checkout:
    name: 'E-Commerce Checkout Process'
    description: 'Orchestrates user, inventory, and payment services'
    
    inputs:
      userId:
        required: true
        schema: { type: string }
      productId:
        required: true
        schema: { type: string }
      quantity:
        required: true
        schema: { type: integer, minimum: 1 }
    
    steps:
      # Step 1: Get user details from user-service
      - id: get-user
        operationId: user-service.getUserById
        inputs:
          userId: { from: workflow/userId }
        outputs:
          email:
            source: responseBody
            path: '$.email'
          paymentMethodId:
            source: responseBody
            path: '$.defaultPaymentMethod'
      
      # Step 2: Check inventory from inventory-service
      - id: check-stock
        operationId: inventory-service.checkAvailability
        inputs:
          productId: { from: workflow/productId }
          quantity: { from: workflow/quantity }
        outputs:
          available:
            source: responseBody
            path: '$.available'
          price:
            source: responseBody
            path: '$.price'
      
      # Step 3: Reserve inventory
      - id: reserve-stock
        operationId: inventory-service.reserveProduct
        dependencies: [ step/check-stock ]
        inputs:
          productId: { from: workflow/productId }
          quantity: { from: workflow/quantity }
        outputs:
          reservationId:
            source: responseBody
            path: '$.reservationId'
      
      # Step 4: Process payment from payment-service
      - id: process-payment
        operationId: payment-service.createCharge
        dependencies: [ step/get-user, step/check-stock ]
        inputs:
          paymentMethodId: { from: step/get-user, output: paymentMethodId }
          amount: { from: step/check-stock, output: price }
          currency: { const: 'USD' }
        outputs:
          chargeId:
            source: responseBody
            path: '$.id'
          status:
            source: responseBody
            path: '$.status'
      
      # Step 5: Confirm order (using method+path with source)
      - id: confirm-order
        method: POST
        path: /orders
        source: user-service
        dependencies: [ step/reserve-stock, step/process-payment ]
        inputs:
          userId: { from: workflow/userId }
          productId: { from: workflow/productId }
          quantity: { from: workflow/quantity }
          reservationId: { from: step/reserve-stock, output: reservationId }
          chargeId: { from: step/process-payment, output: chargeId }
        outputs:
          orderId:
            source: responseBody
            path: '$.orderId'
    
    outputs:
      orderId:
        from: step/confirm-order
        output: orderId
      chargeId:
        from: step/process-payment
        output: chargeId
```

### 3.3 Workflow Object

Each workflow is defined by the following properties:

| Property      | Type   | Required | Description                                 |
|---------------|--------|----------|---------------------------------------------|
| `name`        | string | No       | Human-readable title for the workflow       |
| `description` | string | No       | Explains purpose, behavior, and assumptions |
| `inputs`      | object | No       | Declares workflow-level parameters          |
| `auth`        | object | No       | Default authentication for all steps        |
| `steps`       | array  | **Yes**  | Ordered list of steps (minimum 1)           |
| `outputs`     | object | No       | Named aliases exposing step outputs         |
| `deprecated`  | object | No       | Deprecation metadata                        |

#### Example:

```yaml
workflows:
  user-registration:
    name: 'User Registration Flow'
    description: 'Creates a new user account and sends welcome email'
    inputs:
      email:
        description: "User's email address"
        required: true
        schema:
          type: string
          format: email
      sendWelcome:
        description: 'Whether to send welcome email'
        required: false
        schema:
          type: boolean
        default: true
    steps:
      - id: create-user
        operationId: createUser
        inputs:
          email: { from: workflow/email }
      - id: send-email
        operationId: sendEmail
        dependencies: [ step/create-user ]
        inputs:
          userId: { from: step/create-user, output: userId }
    outputs:
      userId:
        from: step/create-user
        output: userId
```

## 4. Workflow Inputs

Workflow inputs declare parameters that callers may override at runtime.

### 4.1 WorkflowInput Schema

| Property      | Type    | Required | Description                                                                   |
|---------------|---------|----------|-------------------------------------------------------------------------------|
| `description` | string  | No       | Explains parameter purpose and usage                                          |
| `required`    | boolean | No       | Whether callers must provide this input (default: false)                      |
| `schema`      | object  | **Yes**  | JSON Schema describing expected value type                                    |
| `default`     | any     | No       | Default value when caller doesn't provide input                               |
| `sensitive`   | boolean | No       | Marks input as containing sensitive data for masking in logs (default: false) |

#### Example:

```yaml
inputs:
  namespace:
    description: 'Kubernetes namespace for deployment'
    required: true
    schema:
      type: string
      pattern: '^[a-z0-9-]+$'
  
  replicas:
    description: 'Number of pod replicas'
    required: false
    schema:
      type: integer
      minimum: 1
      maximum: 10
    default: 3
  
  config:
    description: 'Application configuration'
    required: false
    schema:
      type: object
      properties:
        debug:
          type: boolean
        timeout:
          type: integer
    default:
      debug: false
      timeout: 30
```

### 4.2 Sensitive Workflow Inputs

Mark workflow inputs containing confidential data (passwords, tokens, API keys, secrets) as sensitive to ensure proper handling by workflow engines.

**Syntax:**

```yaml
inputs:
  password:
    description: 'User password'
    required: true
    schema:
      type: string
      format: password
    sensitive: true  # Masked in logs and error messages
  
  apiKey:
    description: 'API authentication key'
    required: true
    schema:
      type: string
    sensitive: true  # Masked in logs and error messages
  
  username:
    description: 'User login name'
    required: true
    schema:
      type: string
    # Not sensitive - usernames are typically not secret
```

**Security Behavior:**

When `sensitive: true` is set on a workflow input:

1. **Input Logging**: The value is masked as `**REDACTED**` when logging workflow execution start
2. **Step Input Propagation**: Any step input that references this workflow input (via `from: workflow/inputName`) is automatically treated as sensitive
3. **Error Messages**: The value is excluded from exception messages and validation errors
4. **Audit Trails**: The value should be hashed or omitted from audit logs

**What to Mark as Sensitive:**

Always mark these workflow input types as sensitive:

```yaml
inputs:
  # Passwords and credentials
  password:
    schema: { type: string, format: password }
    sensitive: true  # Required
  
  clientSecret:
    schema: { type: string }
    sensitive: true  # Required
  
  # API keys and tokens
  apiKey:
    schema: { type: string }
    sensitive: true  # Required
  
  accessToken:
    schema: { type: string }
    sensitive: true  # Required
  
  # Encryption keys
  encryptionKey:
    schema: { type: string }
    sensitive: true  # Required
  
  # Private keys and certificates
  privateKey:
    schema: { type: string }
    sensitive: true  # Required
```

**What NOT to Mark as Sensitive:**

Non-confidential data should not be marked sensitive:

```yaml
inputs:
  # Usernames are typically public
  username:
    schema: { type: string }
    sensitive: false  # or omit (default)
  
  # Email addresses are not secret
  email:
    schema: { type: string, format: email }
    # Not marked sensitive
  
  # Configuration values
  region:
    schema: { type: string }
    # Not marked sensitive
  
  # Public identifiers
  userId:
    schema: { type: string }
    # Not marked sensitive
```

**Complete Example:**

```yaml
workflows:
  secure-api-call:
    name: 'Secure API Integration'
    
    inputs:
      # Non-sensitive inputs
      userId:
        description: 'User identifier'
        required: true
        schema: { type: string }
        # Not sensitive - public ID
      
      region:
        description: 'API region'
        required: false
        schema: { type: string }
        default: 'us-east-1'
        # Not sensitive - configuration value
      
      # Sensitive inputs
      apiKey:
        description: 'API authentication key'
        required: true
        schema: { type: string }
        sensitive: true  # Masked in logs
      
      encryptionSecret:
        description: 'Data encryption secret'
        required: true
        schema: { type: string }
        sensitive: true  # Masked in logs
    
    steps:
      - id: call-api
        operationId: getData
        auth:
          type: apiKey
          in: header
          name: X-API-Key
          value: { from: workflow/apiKey }  # Automatically treated as sensitive
        inputs:
          userId: { from: workflow/userId }
          secret: { from: workflow/encryptionSecret }  # Automatically treated as sensitive

# Execution log output:
# [2025-11-27 11:00:00] Starting workflow 'secure-api-call'
# [2025-11-27 11:00:00] Input 'userId': 'user-12345'
# [2025-11-27 11:00:00] Input 'region': 'us-east-1'
# [2025-11-27 11:00:00] Input 'apiKey': **REDACTED**
# [2025-11-27 11:00:00] Input 'encryptionSecret': **REDACTED**
```

### 4.3 Referencing Workflow Inputs

Steps reference workflow inputs using the `workflow/<inputName>` format:

```yaml
steps:
  - id: deploy
    operationId: createDeployment
    inputs:
      namespace: { from: workflow/namespace }
      replicas: { from: workflow/replicas }
```

## 5. Steps

Steps define the executable operations within a workflow.

### 5.1 Step Schema

| Property       | Type   | Required    | Description                                                      |
|----------------|--------|-------------|------------------------------------------------------------------|
| `id`           | string | **Yes**     | Unique identifier (pattern: `^[a-zA-Z0-9_.-]+$`)                 |
| `description`  | string | No          | Explains what the step accomplishes                              |
| `operationId`  | string | Conditional | OpenAPI operationId (supports qualified notation for multi-API)  |
| `method`       | string | Conditional | HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)       |
| `path`         | string | Conditional | OpenAPI path paired with method                                  |
| `source`       | string | Conditional | API source name when using method+path with multiple APIs        |
| `workflowRef`  | string | Conditional | Reference to another workflow                                    |
| `auth`         | object | No          | Authentication configuration (inherits from workflow if omitted) |
| `redirect`     | string | No          | How to handle HTTP redirects (none, first, last)                 |
| `dependencies` | array  | No          | Step identifiers that must complete first (format: `step/`)      |
| `inputs`       | object | No          | Named inputs consumed by this step                               |
| `outputs`      | object | No          | Named outputs emitted by this step                               |
| `tags`         | array  | No          | Optional labels for grouping                                     |

### 5.2 Operation Selection (Mutually Exclusive)

Each step must specify exactly **one** of the following:

1. **operationId**: Reference an OpenAPI operation by its unique ID
2. **method + path**: Target an OpenAPI path with an HTTP method
3. **workflowRef**: Execute another workflow

#### Examples:

**Using operationId (single API):**

```yaml
- id: get-user
  operationId: getUserById
  inputs:
    userId: { const: '12345' }
```

**Using qualified operationId (multi-API):**

When `sourceDescriptions` are defined at the root level, use qualified notation:

```yaml
sourceDescriptions:
  - name: user-api
    url: https://api.example.com/users/openapi.yaml
  - name: order-api
    url: https://api.example.com/orders/openapi.yaml

workflows:
  checkout:
    steps:
      - id: get-user
        operationId: user-api.getUserById  # Qualified with source name
        inputs:
          userId: { const: '12345' }
      
      - id: create-order
        operationId: order-api.createOrder  # Different API
        dependencies: [ step/get-user ]
        inputs:
          userId: { from: step/get-user, output: userId }
```

**Using method + path (single API):**

```yaml
- id: get-user
  method: GET
  path: /users/{userId}
  inputs:
    userId: { const: '12345' }
```

**Using method + path with source (multi-API):**

When multiple `sourceDescriptions` exist, specify which API contains the path:

```yaml
sourceDescriptions:
  - name: user-api
    url: https://api.example.com/users/openapi.yaml
  - name: product-api
    url: https://api.example.com/products/openapi.yaml

workflows:
  catalog:
    steps:
      - id: get-user
        method: GET
        path: /users/{userId}
        source: user-api  # Required with multiple sourceDescriptions
        inputs:
          userId: { const: '12345' }
      
      - id: get-product
        method: GET
        path: /products/{productId}
        source: product-api  # Different API
        inputs:
          productId: { const: 'prod-456' }
```

**Using workflowRef:**

```yaml
- id: provision-infrastructure
  workflowRef: '#/workflows/setup-environment'
  inputs:
    region: { from: workflow/region }
```

### 5.3 Authentication

Workflows and steps can specify authentication requirements for API requests. Authentication can be configured at the workflow level (inherited by all steps) or at the step level (overriding workflow authentication).

#### 5.3.1 Workflow-Level Authentication

Define default authentication that all steps inherit:

```yaml
workflows:
  authenticated-workflow:
    inputs:
      apiToken:
        required: true
        schema:
          type: string
    
    auth:
      type: bearer
      token: { from: workflow/apiToken }
    
    steps:
      - id: get-user
        operationId: getUserById
        # Automatically uses workflow.auth (bearer token)
      
      - id: update-user
        operationId: updateUser
        # Also uses workflow.auth (bearer token)
```

#### 5.3.2 Step-Level Authentication

Steps can override workflow authentication or define their own:

```yaml
workflows:
  mixed-auth-workflow:
    inputs:
      apiToken:
        required: true
        schema: { type: string }
      adminUser:
        required: true
        schema: { type: string }
      adminPass:
        required: true
        schema: { type: string, format: password }
    
    auth:
      type: bearer
      token: { from: workflow/apiToken }
    
    steps:
      - id: protected-endpoint
        operationId: getProtectedData
        # Uses workflow.auth (bearer token)
      
      - id: admin-endpoint
        operationId: adminAction
        auth:
          type: basic
          username: { from: workflow/adminUser }
          password: { from: workflow/adminPass }
        # Overrides with basic auth
      
      - id: public-endpoint
        operationId: getPublicData
        auth: null
        # Explicitly disables authentication
```

#### 5.3.3 Authentication Types

##### Basic Authentication

Username and password credentials:

```yaml
auth:
  type: basic
  username: { from: workflow/username }
  password: { from: workflow/password }
```

##### Bearer Token

Token-based authentication (OAuth 2.0, JWT, etc.):

```yaml
auth:
  type: bearer
  token: { from: workflow/accessToken }
```

Or referencing a previous step's output:

```yaml
auth:
  type: bearer
  token: { from: step/login, output: accessToken }
```

##### OAuth2

Semantically indicates OAuth 2.0 (functionally identical to bearer):

```yaml
auth:
  type: oauth2
  token: { from: step/get-token, output: access_token }
```

##### API Key

API key in header, query parameter, or cookie:

**Header:**

```yaml
auth:
  type: apiKey
  in: header
  name: X-API-Key
  value: { from: workflow/apiKey }
```

**Query Parameter:**

```yaml
auth:
  type: apiKey
  in: query
  name: api_key
  value: { from: workflow/apiKey }
```

**Cookie:**

```yaml
auth:
  type: apiKey
  in: cookie
  name: session_id
  value: { from: step/login, output: sessionId }
```

#### 5.3.4 Implicit Sensitivity of Authentication Fields

**All authentication credential fields are automatically treated as sensitive**, regardless of whether they use literal values or references. Workflow engines must mask these values in logs, error messages, and debugging output.

**Implicitly Sensitive Fields:**

- **Basic Auth**: `username` and `password`
- **Bearer/OAuth2**: `token`
- **API Key**: `value`

This implicit sensitivity applies whether the credentials come from:
- Workflow inputs: `{ from: workflow/password }`
- Step outputs: `{ from: step/login, output: token }`
- Literal values: `{ const: 'secret' }` (strongly discouraged)

**Example - No Explicit `sensitive` Flag Needed:**

```yaml
workflows:
  implicit-auth-security:
    inputs:
      # Password input should be marked sensitive
      password:
        required: true
        schema: { type: string, format: password }
        sensitive: true  # Workflow input needs explicit flag
      
      # API key input should be marked sensitive
      apiKey:
        required: true
        schema: { type: string }
        sensitive: true  # Workflow input needs explicit flag
    
    steps:
      - id: login
        operationId: authenticate
        auth:
          type: basic
          username: { const: 'admin' }
          password: { from: workflow/password }
          # ✓ Both username and password are automatically masked in auth logs
          # No need to mark the auth fields themselves as sensitive

# Execution log output:
# [2025-11-27 11:15:00] Step 'login' executing
# [2025-11-27 11:15:00] Auth type: basic
# [2025-11-27 11:15:00] Auth username: **REDACTED**
# [2025-11-27 11:15:00] Auth password: **REDACTED**
```

**Key Points:**

1. **Workflow inputs** containing credentials should be explicitly marked `sensitive: true`
2. **Authentication fields** (username, password, token, value) are implicitly sensitive without needing explicit flags
3. **Step outputs** containing credentials should be explicitly marked `sensitive: true`

This two-level approach ensures comprehensive security:
- Sensitive data is masked at its source (workflow inputs, step outputs)
- Authentication usage is always masked automatically (auth fields)

#### 5.3.5 Disabling Authentication

To explicitly disable authentication:

**At step level (override workflow auth):**

```yaml
steps:
  - id: public-call
    operationId: getPublicData
    auth: null
```

**At workflow level:**

**Important distinction:**
- **Omitting `auth`**: Step inherits authentication from workflow-level `auth` (if present). If workflow has no `auth`, step has no authentication.
- **Explicit `auth: null`**: Step explicitly disables authentication, even if workflow-level `auth` is defined. This overrides workflow authentication.

#### 5.3.6 Complete Example

```yaml
workflows:
  multi-step-auth:
    name: 'Multi-Step Authentication Flow'
    
    inputs:
      username:
        required: true
        schema: { type: string }
        # Username not marked sensitive - typically not secret
      password:
        required: true
        schema: { type: string, format: password }
        sensitive: true  # Password must be marked sensitive
      apiKey:
        required: true
        schema: { type: string }
        sensitive: true  # API key must be marked sensitive
    
    steps:
      # Step 1: Login to get access token
      - id: login
        operationId: authenticateUser
        auth:
          type: basic
          username: { from: workflow/username }
          password: { from: workflow/password }
        outputs:
          accessToken:
            source: responseBody
            path: '$.access_token'
            sensitive: true  # Access token is sensitive
      
      # Step 2: Use bearer token from login
      - id: get-profile
        operationId: getUserProfile
        dependencies: [ step/login ]
        auth:
          type: bearer
          token: { from: step/login, output: accessToken }
        outputs:
          userId:
            source: responseBody
            path: '$.id'
      
      # Step 3: Call external API with different auth
      - id: get-external-data
        operationId: fetchExternalResource
        dependencies: [ step/get-profile ]
        auth:
          type: apiKey
          in: header
          name: X-API-Key
          value: { from: workflow/apiKey }
        inputs:
          userId: { from: step/get-profile, output: userId }
      
      # Step 4: Public endpoint with no auth
      - id: get-public-info
        operationId: getPublicInfo
        auth: null
    
    outputs:
      userId:
        from: step/get-profile
        output: userId
```

### 5.4 Redirect Behavior

The `redirect` property controls how the workflow engine handles HTTP redirect responses (3xx status codes). This is critical for OAuth flows, which rely on capturing query parameters from redirect URLs.

#### 5.4.1 Redirect Modes

| Mode    | Description                                      | Typical Use Case                 |
|---------|--------------------------------------------------|----------------------------------|
| `none`  | Return the raw 3xx response without processing   | Debug redirect chains            |
| `first` | Stop at first redirect, extract query parameters | OAuth authorization code capture |
| `last`  | Follow redirects to final non-3xx response       | Standard API calls               |

#### 5.4.2 Smart Defaults

The workflow engine determines the default redirect mode based on step outputs:

- **Has `redirectQuery` outputs** → defaults to `first`
- **No `redirectQuery` outputs** → defaults to `last`

This means most workflows don't need explicit `redirect` configuration.

#### 5.4.3 First Mode

Stops at the first HTTP 3xx redirect and captures query parameters from the `Location` header.

**Example:**

```yaml
- id: oauth-authorize
  operationId: Authorize
  redirect: first
  inputs:
    client_id: { from: workflow/clientId }
    response_type: { const: 'code' }
  outputs:
    code:
      source: redirectQuery
      parameter: code
    state:
      source: redirectQuery
      parameter: state
```

**Behavior:**
1. Request to `/oauth/authorize` returns `302 Found`
2. Engine stops without following the redirect
3. Parses `Location: https://callback?code=ABC123&state=xyz`
4. Extracts `code` and `state` from query parameters

**Common Uses:**
- OAuth 2.0 authorization code flow
- SAML authentication redirects
- Any flow where redirect URL contains data

#### 5.4.4 Last Mode

Follows all redirects until reaching a non-3xx response.

**Example:**

```yaml
- id: get-resource
  operationId: getResource
  redirect: last
  outputs:
    data:
      source: responseBody
      path: '$.items'
```

**Behavior:**
1. Request to `/api/resource` returns `302 → /new-location`
2. Second request returns `301 → /final-location`  
3. Third request returns `200 OK` with response body
4. Engine returns the final `200` response

**Common Uses:**
- APIs with permanent redirects (301/308)
- Temporary redirects (302/307)
- CDN-hosted resources
- URL shortener services

#### 5.4.5 None Mode

Returns the raw redirect response without any processing.

**Example:**

```yaml
- id: check-redirect
  operationId: checkEndpoint
  redirect: none
  outputs:
    location:
      source: responseHeader
      header: Location
    status:
      source: statusCode
```

**Behavior:**
1. Request to `/api/endpoint` returns `302 Found`
2. Engine returns the `302` response immediately
3. No redirect following, no query parameter extraction
4. Status code output will be `302`, not `200`

**Common Uses:**
- Debugging redirect chains
- Testing redirect behavior
- Conditional redirect logic
- Custom redirect handling workflows

#### 5.4.6 OAuth Flow Example

Complete OAuth 2.0 authorization code flow with PKCE:

```yaml
workflows:
  oauth-code-flow:
    name: 'OAuth 2.0 with PKCE'
    
    inputs:
      clientId:
        required: true
        schema: { type: string }
      codeVerifier:
        required: true
        schema: { type: string }
      codeChallenge:
        required: true
        schema: { type: string }
    
    steps:
      # Authorization: capture redirect with code
      - id: authorize
        operationId: Authorize
        redirect: first  # Stop at redirect, don't follow
        inputs:
          client_id: { from: workflow/clientId }
          code_challenge: { from: workflow/codeChallenge }
          code_challenge_method: { const: 'S256' }
          response_type: { const: 'code' }
        outputs:
          auth_code:
            source: redirectQuery
            parameter: code
          request_id:
            source: redirectQuery
            parameter: request_id
      
      # Token exchange: normal request/response
      - id: get-token
        operationId: TokenGrant
        dependencies: [ step/authorize ]
        # redirect: last (implicit default - no redirectQuery outputs)
        inputs:
          grant_type: { const: 'authorization_code' }
          code: { from: step/authorize, output: auth_code }
          code_verifier: { from: workflow/codeVerifier }
          client_id: { from: workflow/clientId }
        outputs:
          access_token:
            source: responseBody
            path: '$.access_token'
          refresh_token:
            source: responseBody
            path: '$.refresh_token'
    
    outputs:
      accessToken:
        from: step/get-token
        output: access_token
      refreshToken:
        from: step/get-token
        output: refresh_token
```

**Note:** The token exchange step doesn't need `redirect: last` because:
- It has no `redirectQuery` outputs
- Default mode is `last` for normal request/response

#### 5.4.7 Implicit Defaults Example

Most workflows benefit from smart defaults:

```yaml
steps:
  # Implicitly uses redirect: first
  - id: oauth-step
    operationId: authorize
    outputs:
      code:
        source: redirectQuery  # Engine detects this
        parameter: code
  
  # Implicitly uses redirect: last
  - id: api-call
    operationId: getData
    dependencies: [ step/oauth-step ]
    outputs:
      result:
        source: responseBody  # No redirectQuery
        path: '$.data'
```

Only specify `redirect` explicitly when:
- Overriding the smart default
- Clarifying intent for documentation
- Using `none` mode for debugging

### 5.5 Dependencies

The `dependencies` array specifies step identifiers (using the `step/<stepId>` format) that must complete before this step executes:

```yaml
steps:
  - id: create-user
    operationId: createUser
    inputs:
      email: { from: workflow/email }
  
  - id: create-profile
    operationId: createProfile
    dependencies: [ step/create-user ]
    inputs:
      userId: { from: step/create-user, output: userId }
  
  - id: send-welcome
    operationId: sendEmail
    dependencies: [ step/create-user ]
    inputs:
      email: { from: workflow/email }
  
  - id: log-completion
    operationId: logEvent
    dependencies: [ step/create-profile, step/send-welcome ]
    inputs:
      event: { const: "registration-complete" }
```

In this example:
- `create-profile` and `send-welcome` run after `create-user`
- `log-completion` waits for both `create-profile` and `send-welcome`

The `step/` prefix maintains consistency with how steps are referenced in input references and output references throughout the workflow.

## 6. Step Inputs

Step inputs provide data to the operation being executed. Inputs can be literals or references.

### 6.1 StepInputLiteral

Static values provided directly:

```yaml
inputs:
  status: { const: 'active' }
  maxResults: { const: 100 }
  config: 
    const:
      debug: true
      retries: 3
```

**Sensitive Literal Values:**

Literal values containing sensitive data can be marked with `sensitive: true`, though **hardcoding secrets is strongly discouraged**:

```yaml
inputs:
  # ❌ DISCOURAGED: Hardcoding sensitive values
  fallbackApiKey:
    const: 'sk_test_...'
    sensitive: true  # At least mask it in logs
  
  # ✅ RECOMMENDED: Use workflow inputs instead
  apiKey: { from: workflow/apiKey }
```

**Best Practice:** Never hardcode passwords, tokens, or API keys in literal values. Use workflow inputs instead. The `sensitive` property on literals exists only for edge cases where hardcoding is unavoidable.

**Example showing when literal sensitive might be used:**

```yaml
steps:
  # Edge case: temporary development/testing credential
  - id: dev-health-check
    operationId: checkHealth
    inputs:
      testToken:
        const: 'dev_temp_token_12345'
        sensitive: true  # Masked in logs during development
```

### 6.2 StepInputReference

References to workflow inputs or step outputs:

| Property    | Type   | Required    | Description                                                                      |
|-------------|--------|-------------|----------------------------------------------------------------------------------|
| `from`      | string | **Yes**     | Source identifier (`step/` or `workflow/`)                                       |
| `output`    | string | Conditional | **Required** for step references. **Forbidden** for workflow input references    |
| `transform` | string | No          | JSONPath expression (RFC 9535) to transform data                                 |

**Output Field Behavior:**
- **For `step/` references**: `output` is **required** and must specify the name of an output from the referenced step
- **For `workflow/` references**: `output` is **forbidden** - the step input parameter name (object key) directly identifies which workflow input to reference

#### Examples:

**Referencing workflow input:**

```yaml
inputs:
  email: { from: workflow/email }
  # The key 'email' is the step input parameter name
  # It pulls from the workflow input named 'email'
```

**Referencing step output:**

```yaml
inputs:
  userId: { from: step/create-user, output: userId }
```

**With transformation:**

```yaml
inputs:
  # Extract email from nested user profile
  email: 
    from: step/getUserProfile
    output: profile
    transform: '$.user.email'
  
  # Get first item ID from array
  firstItemId:
    from: step/listItems
    output: items
    transform: '$[0].id'
  
  # Extract nested configuration
  timeout:
    from: workflow/config
    transform: '$.server.timeout'
```

## 7. Step Outputs

Outputs capture data from step execution for use by subsequent steps or workflow outputs.

### 7.1 StepOutput Schema

| Property    | Type    | Required    | Description                                                                    |
|-------------|---------|-------------|--------------------------------------------------------------------------------|
| `source`    | string  | **Yes**     | Origin of the data (redirectQuery, responseBody, responseHeader, statusCode)   |
| `parameter` | string  | Conditional | Query parameter name (required if source=redirectQuery)                        |
| `path`      | string  | Conditional | JSONPath expression (required if source=responseBody)                          |
| `header`    | string  | Conditional | HTTP header name (required if source=responseHeader)                           |
| `default`   | any     | No          | Default value if output cannot be captured (missing parameter, header, etc.)   |
| `sensitive` | boolean | No          | Marks output as containing sensitive data for masking in logs (default: false) |

### 7.2 Source Types

#### 7.2.1 redirectQuery

Captures query parameters from HTTP redirect responses (3xx status codes).

```yaml
outputs:
  authCode:
    source: redirectQuery
    parameter: code
  
  state:
    source: redirectQuery
    parameter: state
```

**Redirect Behavior:**

When a step has `redirectQuery` outputs, the workflow engine automatically uses `redirect: first` mode (stop at first redirect). You can explicitly specify `redirect: first` for clarity, but it's not required.

See [Section 5.4 (Redirect Behavior)](#54-redirect-behavior) for complete documentation on redirect handling.

**Use Case:** OAuth 2.0 authorization code flow where the authorization server redirects back with `code` and `state` parameters.

#### 7.2.2 responseBody

Extracts values from JSON response bodies using JSONPath:

```yaml
outputs:
  userId:
    source: responseBody
    path: '$.id'
  
  userName:
    source: responseBody
    path: '$.profile.name'
  
  allEmails:
    source: responseBody
    path: '$.users[*].email'
  
  firstResult:
    source: responseBody
    path: '$.results[0]'
```

#### 7.2.3 responseHeader

Captures HTTP response headers:

```yaml
outputs:
  location:
    source: responseHeader
    header: Location
  
  contentType:
    source: responseHeader
    header: Content-Type
  
  rateLimitRemaining:
    source: responseHeader
    header: X-RateLimit-Remaining
```

#### 7.2.4 statusCode

Captures the HTTP status code:

```yaml
outputs:
  httpStatus:
    source: statusCode
```

**Use Case:** Conditional logic based on response codes (200, 201, 404, etc.)

### 7.2.5 Output Capture Behavior

When an output cannot be captured from its source, the behavior depends on whether a `default` value is specified:

**Without default:**
- **redirectQuery**: If the query parameter is missing from the redirect URL, the step fails with an error
- **responseBody**: If the JSONPath expression doesn't match any data, the step fails with an error
- **responseHeader**: If the header is not present in the response, the step fails with an error
- **statusCode**: Always succeeds (status codes are always present)

**With default:**
```yaml
outputs:
  # Optional query parameter with fallback
  state:
    source: redirectQuery
    parameter: state
    default: null
  
  # Optional response field with default value
  displayName:
    source: responseBody
    path: '$.user.displayName'
    default: 'Anonymous'
  
  # Optional header with default
  cacheControl:
    source: responseHeader
    header: Cache-Control
    default: 'no-cache'
```

When a `default` is specified, the output will use the default value instead of failing if:
- The query parameter is not present in the redirect URL
- The JSONPath expression evaluates to null or doesn't match
- The response header is not present

**Error vs. Null Handling:**
- Missing data **without** `default` → Step fails, workflow halts
- Missing data **with** `default` → Output uses default value, execution continues
- This allows workflows to gracefully handle optional data from external systems

**Default Value Types:**
The `default` value should match the expected type for the output source:
- **redirectQuery**: string (query parameter values are strings)
- **responseHeader**: string (HTTP header values are strings)
- **responseBody**: any valid JSON type (depends on the JSONPath expression and API response)
- **statusCode**: integer (HTTP status codes like 200, 404, 500)

Runtime engines should validate that default values conform to these type expectations. If a default value has an incompatible type (e.g., providing an integer for a redirectQuery output), the workflow engine should reject the workflow during pre-execution validation.

### 7.2.6 Sensitive Output Handling

The `sensitive` property marks outputs containing confidential data such as passwords, tokens, API keys, or secrets. When set to `true`, workflow engines should automatically mask the output value in logs, error messages, and debugging output.

**Syntax:**

```yaml
outputs:
  accessToken:
    source: responseBody
    path: '$.access_token'
    sensitive: true
  
  apiKey:
    source: responseHeader
    header: X-API-Key
    sensitive: true
```

**Security Behavior:**

When `sensitive: true` is set:
- **Logging**: Output values are masked as `**REDACTED**` in execution logs
- **Error Messages**: Values are not included in exception messages or stack traces
- **Debug Output**: Development tools should hide or obfuscate these values
- **Audit Trails**: Sensitive values should be hashed or omitted from audit logs

**What to Mark as Sensitive:**

Mark these types of outputs as sensitive:

```yaml
outputs:
  # Authentication tokens
  accessToken:
    source: responseBody
    path: '$.access_token'
    sensitive: true
  
  refreshToken:
    source: responseBody
    path: '$.refresh_token'
    sensitive: true
  
  # API keys and secrets
  apiKey:
    source: responseBody
    path: '$.api_key'
    sensitive: true
  
  clientSecret:
    source: responseBody
    path: '$.client_secret'
    sensitive: true
  
  # Passwords and credentials
  temporaryPassword:
    source: responseBody
    path: '$.temp_password'
    sensitive: true
  
  # Session identifiers
  sessionId:
    source: responseHeader
    header: Set-Cookie
    sensitive: true
  
  # OAuth authorization codes
  authCode:
    source: redirectQuery
    parameter: code
    sensitive: true
```

**What NOT to Mark as Sensitive:**

Non-sensitive data should not be marked as sensitive to maintain debugging visibility:

```yaml
outputs:
  # Public identifiers - OK to log
  userId:
    source: responseBody
    path: '$.user.id'
    sensitive: false  # or omit (default)
  
  # Status codes - OK to log
  httpStatus:
    source: statusCode
    sensitive: false
  
  # Public URLs - OK to log
  profileUrl:
    source: responseBody
    path: '$.profile_url'
    sensitive: false
```

**Propagation Through Workflow:**

When a sensitive output is referenced in subsequent steps, the sensitivity propagates:

```yaml
steps:
  # Step 1: Get token (marked sensitive)
  - id: login
    operationId: authenticate
    outputs:
      token:
        source: responseBody
        path: '$.access_token'
        sensitive: true
  
  # Step 2: Use token (automatically treated as sensitive in logs)
  - id: get-profile
    operationId: getUserProfile
    dependencies: [ step/login ]
    inputs:
      # This value is automatically masked in logs
      authorization: { from: step/login, output: token }
```

**Complete Example:**

```yaml
workflows:
  secure-authentication:
    name: 'Secure Authentication Flow'
    
    inputs:
      username:
        required: true
        schema: { type: string }
      password:
        required: true
        schema: { type: string, format: password }
    
    steps:
      - id: login
        operationId: authenticateUser
        inputs:
          username: { from: workflow/username }
          password: { from: workflow/password }
        outputs:
          accessToken:
            source: responseBody
            path: '$.access_token'
            sensitive: true  # Token masked in logs
          
          userId:
            source: responseBody
            path: '$.user.id'
            sensitive: false  # User ID is public
          
          expiresIn:
            source: responseBody
            path: '$.expires_in'
            # Not marked sensitive - just a timestamp
      
      - id: get-api-key
        operationId: generateApiKey
        dependencies: [ step/login ]
        auth:
          type: bearer
          token: { from: step/login, output: accessToken }
        outputs:
          apiKey:
            source: responseBody
            path: '$.api_key'
            sensitive: true  # API key masked in logs
    
    outputs:
      userId:
        from: step/login
        output: userId
        # Not sensitive - user IDs are public identifiers
      
      apiKey:
        from: step/get-api-key
        output: apiKey
        sensitive: true  # Workflow output also marked sensitive
```

### 7.3 Complete Step Example

```yaml
- id: create-user
  description: 'Creates a new user account'
  operationId: createUser
  inputs:
    email: { from: workflow/email }
    name: { from: workflow/name }
  outputs:
    userId:
      source: responseBody
      path: '$.user.id'
    status:
      source: statusCode
    location:
      source: responseHeader
      header: Location
```

## 8. Workflow Outputs

Workflow outputs expose selected step outputs to consumers.

The `outputs` property is optional—workflows that perform actions without returning data (e.g., notification workflows, logging workflows) may omit it entirely.

### 8.1 WorkflowOutput Schema

| Property    | Type    | Required | Description                                                                    |
|-------------|---------|----------|--------------------------------------------------------------------------------|
| `from`      | string  | **Yes**  | Step identifier (format: `step/`)                                              |
| `output`    | string  | **Yes**  | Name of the output from the referenced step                                    |
| `sensitive` | boolean | No       | Marks output as containing sensitive data for masking in logs (default: false) |

#### Example:

```yaml
outputs:
  userId:
    from: step/create-user
    output: userId
    # Not sensitive - public identifier
  
  sessionToken:
    from: step/login
    output: token
    sensitive: true  # Token should be masked in logs
  
  profileUrl:
    from: step/create-profile
    output: location
    # Not sensitive - public URL
```

**Sensitive Workflow Outputs:**

When exposing step outputs at the workflow level, you can mark them as sensitive to ensure proper handling by consumers:

```yaml
workflows:
  authentication:
    steps:
      - id: login
        operationId: authenticate
        outputs:
          accessToken:
            source: responseBody
            path: '$.access_token'
            sensitive: true
          userId:
            source: responseBody
            path: '$.user.id'
    
    outputs:
      # Expose sensitive token - marked as sensitive at workflow level
      accessToken:
        from: step/login
        output: accessToken
        sensitive: true
      
      # Expose non-sensitive user ID
      userId:
        from: step/login
        output: userId
```

Consumers of the workflow can access these outputs directly without knowing the internal step structure. The `sensitive` flag signals to workflow consumers and orchestration systems that these values should be handled securely.

## 9. Workflow References

Workflows can reference other workflows for composition and reuse.

### 9.1 WorkflowReference Format

References use JSONRef format: `#/workflows/{workflowIdentifier}`

```yaml
- id: setup
  workflowRef: '#/workflows/environment-setup'
  inputs:
    region: { from: workflow/region }
```

### 9.2 Output Mapping for Workflow Steps

When a step executes another workflow via `workflowRef`, the referenced workflow's outputs automatically become the outputs of that step. Subsequent steps reference these outputs using the step's ID, not the workflow's ID.

#### 9.2.1 How It Works

**The Referenced Workflow:**
```yaml
workflows:
  create-vpc:
    name: 'Create VPC'
    description: 'Provisions a VPC and returns network details'
    
    inputs:
      region:
        required: true
        schema:
          type: string
      name:
        required: true
        schema:
          type: string
    
    steps:
      - id: provision
        operationId: createVPC
        inputs:
          region: { from: workflow/region }
          vpcName: { from: workflow/name }
        outputs:
          vpcId:
            source: responseBody
            path: '$.vpc.id'
          cidrBlock:
            source: responseBody
            path: '$.vpc.cidrBlock'
    
    outputs:
      vpcId:
        from: step/provision
        output: vpcId
      cidrBlock:
        from: step/provision
        output: cidrBlock
```

**The Consuming Workflow:**
```yaml
workflows:
  setup-infrastructure:
    name: 'Setup Infrastructure'
    
    steps:
      # Step executes the create-vpc workflow
      - id: create-network
        workflowRef: '#/workflows/create-vpc'
        inputs:
          region: { const: 'us-east-1' }
          name: { const: 'production-vpc' }
      
      # Subsequent step references outputs from the create-network step
      # NOT from the create-vpc workflow directly
      - id: create-subnet
        operationId: createSubnet
        dependencies: [ step/create-network ]
        inputs:
          vpcId: { from: step/create-network, output: vpcId }
          cidrBlock: { from: step/create-network, output: cidrBlock }
```

**Key Points:**
- The `create-vpc` workflow declares outputs: `vpcId` and `cidrBlock`
- When executed via `workflowRef` in step `create-network`, those outputs become step outputs
- Reference them as `step/create-network`, not `#/workflows/create-vpc`
- The step ID acts as the namespace for accessing workflow outputs
- If the referenced workflow has no `outputs` property, the workflowRef step will have no outputs available for subsequent steps to reference

#### 9.2.2 Multiple References to Same Workflow

You can reference the same workflow multiple times with different step IDs:

```yaml
steps:
  - id: create-vpc-dev
    workflowRef: '#/workflows/create-vpc'
    inputs:
      region: { const: 'us-east-1' }
      name: { const: 'dev-vpc' }
  
  - id: create-vpc-staging
    workflowRef: '#/workflows/create-vpc'
    inputs:
      region: { const: 'us-west-2' }
      name: { const: 'staging-vpc' }
  
  - id: configure-peering
    operationId: createVPCPeering
    dependencies: [ step/create-vpc-dev, step/create-vpc-staging ]
    inputs:
      vpcId1: { from: step/create-vpc-dev, output: vpcId }
      vpcId2: { from: step/create-vpc-staging, output: vpcId }
```

Each step execution is independent and produces its own set of outputs.

#### 9.2.3 No Explicit Auth or Outputs Declaration

Steps using `workflowRef` cannot declare `auth` or `outputs` properties:

**Authentication:** `workflowRef` steps don't make HTTP calls, so they have no authentication. The nested workflow's own `auth` configuration applies to its steps. If the nested workflow needs auth credentials, pass them as regular inputs.

**Example: Passing Auth Credentials to Nested Workflow:**

```yaml
workflows:
  # Parent workflow
  orchestrator:
    inputs:
      apiToken:
        required: true
        schema: { type: string }
    
    steps:
      - id: call-child
        workflowRef: '#/workflows/child-workflow'
        # ❌ Cannot specify auth here - workflowRef steps don't make HTTP calls
        inputs:
          # ✅ Pass auth credentials as regular inputs
          token: { from: workflow/apiToken }
  
  # Child workflow
  child-workflow:
    inputs:
      token:
        required: true
        schema: { type: string }
    
    auth:
      type: bearer
      token: { from: workflow/token }  # Uses passed-in token
    
    steps:
      - id: api-call
        operationId: getData
        # Inherits child-workflow's auth (not parent's)
        outputs:
          result:
            source: responseBody
            path: '$.data'
    
    outputs:
      result:
        from: step/api-call
        output: result
```

Each workflow's authentication is **independent**. Auth credentials flow through the same `inputs` mechanism as any other data.

**Outputs:** Outputs are implicitly inherited from the referenced workflow's output declarations.

**Important:** The outputs available from a `workflowRef` step are exactly those defined in the referenced workflow's `outputs` object. To reference these outputs in subsequent steps, use the step ID (not the workflow ID).


```yaml
# ❌ Invalid - redundant outputs declaration
- id: provision-vpc
  workflowRef: '#/workflows/create-vpc'
  inputs:
    region: { from: workflow/region }
  outputs:  # Not allowed with workflowRef
    vpcId:
      source: responseBody
      path: '$.vpc.id'

# ✅ Valid - outputs inherited automatically from create-vpc workflow
- id: provision-vpc
  workflowRef: '#/workflows/create-vpc'
  inputs:
    region: { from: workflow/region }
  # Outputs available: whatever create-vpc declares in its outputs section

# ✅ Valid - referencing inherited outputs in next step
- id: configure-subnet
  operationId: createSubnet
  dependencies: [ step/provision-vpc ]
  inputs:
    vpcId: { from: step/provision-vpc, output: vpcId }  # vpcId from create-vpc workflow
```

#### 9.2.4 Workflow Composition Example

Complete example showing nested workflow composition:

```yaml
workflows:
  # Leaf workflow - creates a VPC
  create-vpc:
    name: 'Create VPC'
    inputs:
      region:
        required: true
        schema:
          type: string
      name:
        required: true
        schema:
          type: string
    
    steps:
      - id: provision
        operationId: createVPC
        inputs:
          region: { from: workflow/region }
          vpcName: { from: workflow/name }
        outputs:
          vpcId:
            source: responseBody
            path: '$.vpc.id'
          cidrBlock:
            source: responseBody
            path: '$.vpc.cidrBlock'
    
    outputs:
      vpcId:
        from: step/provision
        output: vpcId
      cidrBlock:
        from: step/provision
        output: cidrBlock
  
  # Leaf workflow - creates a database
  create-database:
    name: 'Create Database'
    inputs:
      vpcId:
        required: true
        schema:
          type: string
      dbName:
        required: true
        schema:
          type: string
    
    steps:
      - id: provision-db
        operationId: createRDSInstance
        inputs:
          vpcId: { from: workflow/vpcId }
          name: { from: workflow/dbName }
        outputs:
          endpoint:
            source: responseBody
            path: '$.database.endpoint'
          port:
            source: responseBody
            path: '$.database.port'
    
    outputs:
      endpoint:
        from: step/provision-db
        output: endpoint
      port:
        from: step/provision-db
        output: port
  
  # Mid-level workflow - creates VPC and database
  create-vpc-and-db:
    name: 'Create VPC and Database'
    inputs:
      region:
        required: true
        schema:
          type: string
      projectName:
        required: true
        schema:
          type: string
    
    steps:
      - id: setup-vpc
        workflowRef: '#/workflows/create-vpc'
        inputs:
          region: { from: workflow/region }
          name: { from: workflow/projectName }
      
      - id: setup-db
        workflowRef: '#/workflows/create-database'
        dependencies: [ step/setup-vpc ]
        inputs:
          vpcId: { from: step/setup-vpc, output: vpcId }
          dbName: { from: workflow/projectName }
    
    outputs:
      vpcId:
        from: step/setup-vpc
        output: vpcId
      dbEndpoint:
        from: step/setup-db
        output: endpoint
      dbPort:
        from: step/setup-db
        output: port
  
  # Top-level workflow - orchestrates everything
  deploy-application:
    name: 'Deploy Application'
    inputs:
      projectName:
        required: true
        schema:
          type: string
    
    steps:
      - id: provision-infrastructure
        workflowRef: '#/workflows/create-vpc-and-db'
        inputs:
          region: { const: 'us-east-1' }
          projectName: { from: workflow/projectName }
      
      - id: deploy-app
        operationId: deployApplication
        dependencies: [ step/provision-infrastructure ]
        inputs:
          dbEndpoint: { from: step/provision-infrastructure, output: dbEndpoint }
          dbPort: { from: step/provision-infrastructure, output: dbPort }
    
    outputs:
      appUrl:
        from: step/deploy-app
        output: url
      databaseEndpoint:
        from: step/provision-infrastructure
        output: dbEndpoint
```

In this example:
- `deploy-application` calls `create-vpc-and-db` via step `provision-infrastructure`
- `create-vpc-and-db` itself calls `create-vpc` and `create-database` workflows
- Each `workflowRef` step inherits the outputs of its referenced workflow
- The composition is four workflows deep (deploy-application → create-vpc-and-db → create-vpc/create-database)
- Data flows through the composition: `create-vpc` outputs `vpcId` → `setup-vpc` step inherits it → `setup-db` step consumes it → `create-database` uses it

### 9.3 Deprecation

Mark workflows as deprecated and optionally suggest replacements. The `deprecated` property supports two formats:

**Simple boolean (shorthand):**
```yaml
workflows:
  legacy-auth:
    name: 'Legacy Authentication'
    deprecated: true  # Simple deprecation flag
    steps:
      - id: auth
        operationId: legacyLogin
```

**Object with replacement (detailed):**
```yaml
workflows:
  legacy-auth:
    name: 'Legacy Authentication'
    deprecated:
      value: true
      replacedBy: '#/workflows/oauth2-auth'
    steps:
      - id: auth
        operationId: legacyLogin
```

Use the boolean form when simply marking a workflow as deprecated without providing a replacement. Use the object form when you want to guide users to a newer workflow that replaces the deprecated one.

## 10. Complete Examples

**Note:** All examples in this section omit required root properties (`schemaVersion`, `sourceDescriptions`) for brevity. Complete workflow documents must include these properties as shown in Section 3.1.

### 10.1 OAuth 2.0 Authorization Code Flow

```yaml
workflows:
  oauth2-authorization:
    name: 'OAuth 2.0 Authorization Code Flow'
    description: 'Implements complete OAuth 2.0 authorization code flow with token exchange'
    
    inputs:
      clientId:
        description: 'OAuth client ID'
        required: true
        schema:
          type: string
      
      redirectUri:
        description: 'OAuth redirect URI'
        required: true
        schema:
          type: string
          format: uri
      
      scope:
        description: 'Requested OAuth scopes'
        required: false
        schema:
          type: string
        default: 'read write'
    
    steps:
      - id: authorize
        description: 'Redirect user to authorization endpoint'
        method: GET
        path: /oauth/authorize
        inputs:
          client_id: { from: workflow/clientId }
          redirect_uri: { from: workflow/redirectUri }
          scope: { from: workflow/scope }
          response_type: { const: 'code' }
        outputs:
          code:
            source: redirectQuery
            parameter: code
            sensitive: true  # Authorization codes should be masked
          state:
            source: redirectQuery
            parameter: state
            default: null
      
      - id: exchange-token
        description: 'Exchange authorization code for access token'
        method: POST
        path: /oauth/token
        dependencies: [ step/authorize ]
        inputs:
          client_id: { from: workflow/clientId }
          code: { from: step/authorize, output: code }
          redirect_uri: { from: workflow/redirectUri }
          grant_type: { const: 'authorization_code' }
        outputs:
          accessToken:
            source: responseBody
            path: '$.access_token'
            sensitive: true  # Access tokens must be masked in logs
          refreshToken:
            source: responseBody
            path: '$.refresh_token'
            sensitive: true  # Refresh tokens must be masked in logs
          expiresIn:
            source: responseBody
            path: '$.expires_in'
            # Not sensitive - just a timestamp
    
    outputs:
      accessToken:
        from: step/exchange-token
        output: accessToken
        sensitive: true  # Mark workflow output as sensitive
      
      refreshToken:
        from: step/exchange-token
        output: refreshToken
        sensitive: true  # Mark workflow output as sensitive
```

### 10.2 Multi-Step User Onboarding

```yaml
workflows:
  user-onboarding:
    name: 'Complete User Onboarding'
    description: 'Creates user, profile, and sends welcome email with error handling'
    
    inputs:
      email:
        description: 'User email address'
        required: true
        schema:
          type: string
          format: email
      
      fullName:
        description: "User's full name"
        required: true
        schema:
          type: string
      
      preferences:
        description: 'User preferences'
        required: false
        schema:
          type: object
        default:
          newsletter: true
          notifications: true
    
    steps:
      - id: validate-email
        description: 'Check if email is available'
        operationId: checkEmailAvailability
        inputs:
          email: { from: workflow/email }
        outputs:
          available:
            source: responseBody
            path: '$.available'
      
      - id: create-user
        description: 'Create user account'
        operationId: createUser
        dependencies: [ step/validate-email ]
        inputs:
          email: { from: workflow/email }
          name: { from: workflow/fullName }
        outputs:
          userId:
            source: responseBody
            path: '$.user.id'
          status:
            source: statusCode
      
      - id: create-profile
        description: 'Initialize user profile'
        operationId: createUserProfile
        dependencies: [ step/create-user ]
        inputs:
          userId: { from: step/create-user, output: userId }
          preferences: { from: workflow/preferences }
        outputs:
          profileId:
            source: responseBody
            path: '$.profile.id'
      
      - id: send-welcome-email
        description: 'Send welcome email'
        operationId: sendEmail
        dependencies: [ step/create-user ]
        inputs:
          to: { from: workflow/email }
          template: { const: 'welcome' }
          userId: { from: step/create-user, output: userId }
        outputs:
          emailId:
            source: responseBody
            path: '$.message.id'
      
      - id: log-registration
        description: 'Log successful registration'
        operationId: createAuditLog
        dependencies: [ step/create-profile, step/send-welcome-email ]
        inputs:
          event: { const: 'user.registered' }
          userId: { from: step/create-user, output: userId }
          timestamp: { const: '{{now}}' }
    
    outputs:
      userId:
        from: step/create-user
        output: userId
      
      profileId:
        from: step/create-profile
        output: profileId
```

### 10.3 Workflow Composition

```yaml
workflows:
  setup-dev-environment:
    name: 'Development Environment Setup'
    description: 'Provisions infrastructure and deploys application'
    
    inputs:
      projectName:
        required: true
        schema:
          type: string
      
      region:
        required: false
        schema:
          type: string
        default: 'us-east-1'
    
    steps:
      - id: provision-vpc
        workflowRef: '#/workflows/create-vpc'
        inputs:
          name: 
            from: workflow/projectName
            transform: "$.concat('vpc-', $)"
          region: { from: workflow/region }
      
      - id: provision-database
        workflowRef: '#/workflows/create-database'
        dependencies: [ step/provision-vpc ]
        inputs:
          vpcId: { from: step/provision-vpc, output: vpcId }
          name: { from: workflow/projectName }
      
      - id: deploy-application
        workflowRef: '#/workflows/deploy-app'
        dependencies: [ step/provision-database ]
        inputs:
          dbEndpoint: { from: step/provision-database, output: endpoint }
          environment: { const: 'development' }
    
    outputs:
      vpcId:
        from: step/provision-vpc
        output: vpcId
      
      dbEndpoint:
        from: step/provision-database
        output: endpoint
      
      appUrl:
        from: step/deploy-application
        output: url
```

### 10.4 Edge Cases and Advanced Patterns

This section demonstrates less common but valid workflow patterns and edge cases.

#### 10.4.1 Step with No Inputs

Steps that don't require any input parameters:

```yaml
workflows:
  system-health-check:
    name: 'System Health Check'
    steps:
      # Step with no inputs - calls a simple health endpoint
      - id: check-api-health
        operationId: getHealthStatus
        # No inputs property needed
        outputs:
          status:
            source: statusCode
          healthy:
            source: responseBody
            path: '$.healthy'
      
      - id: check-database
        operationId: getDatabaseHealth
        dependencies: [ step/check-api-health ]
        # Also no inputs needed
        outputs:
          dbStatus:
            source: responseBody
            path: '$.status'
```

#### 10.4.2 Complex Literal Values

Using objects and arrays as literal input values:

```yaml
workflows:
  configure-service:
    name: 'Configure Service with Complex Config'
    steps:
      - id: deploy-with-config
        operationId: deployService
        inputs:
          # Object literal
          config:
            const:
              timeout: 30
              retries: 3
              endpoints:
                primary: 'https://api.example.com'
                fallback: 'https://backup.example.com'
              features:
                - 'caching'
                - 'compression'
                - 'rate-limiting'
          
          # Array literal
          allowedOrigins:
            const:
              - 'https://app.example.com'
              - 'https://www.example.com'
          
          # Null literal
          customDomain:
            const: null
          
          # Boolean literal
          enableMonitoring:
            const: true
        
        outputs:
          serviceId:
            source: responseBody
            path: '$.id'
```

#### 10.4.3 Multiple Dependencies with Fan-In Pattern

Step that waits for multiple independent steps to complete:

```yaml
workflows:
  parallel-processing:
    name: 'Parallel Data Processing with Aggregation'
    
    inputs:
      dataSetId:
        required: true
        schema:
          type: string
    
    steps:
      # Initial step
      - id: fetch-dataset
        operationId: getDataSet
        inputs:
          id: { from: workflow/dataSetId }
        outputs:
          data:
            source: responseBody
            path: '$.data'
      
      # Three independent processing steps running in parallel
      - id: process-analytics
        operationId: runAnalytics
        dependencies: [ step/fetch-dataset ]
        inputs:
          data: { from: step/fetch-dataset, output: data }
        outputs:
          analyticsResult:
            source: responseBody
            path: '$.result'
      
      - id: process-validation
        operationId: validateData
        dependencies: [ step/fetch-dataset ]
        inputs:
          data: { from: step/fetch-dataset, output: data }
        outputs:
          validationResult:
            source: responseBody
            path: '$.isValid'
      
      - id: process-enrichment
        operationId: enrichData
        dependencies: [ step/fetch-dataset ]
        inputs:
          data: { from: step/fetch-dataset, output: data }
        outputs:
          enrichedData:
            source: responseBody
            path: '$.enriched'
      
      # Fan-in: waits for all three parallel steps
      - id: aggregate-results
        operationId: aggregateProcessing
        dependencies: 
          - step/process-analytics
          - step/process-validation
          - step/process-enrichment
        inputs:
          analytics: { from: step/process-analytics, output: analyticsResult }
          validation: { from: step/process-validation, output: validationResult }
          enriched: { from: step/process-enrichment, output: enrichedData }
        outputs:
          finalResult:
            source: responseBody
            path: '$.aggregated'
    
    outputs:
      result:
        from: step/aggregate-results
        output: finalResult
```

#### 10.4.4 JSONPath Transformations

Using transform to extract and reshape data:

```yaml
workflows:
  transform-examples:
    name: 'JSONPath Transform Patterns'
    steps:
      - id: get-user-profile
        operationId: getUserProfile
        outputs:
          profile:
            source: responseBody
            path: '$'
      
      # Extract nested field
      - id: use-email
        operationId: sendNotification
        dependencies: [ step/get-user-profile ]
        inputs:
          email:
            from: step/get-user-profile
            output: profile
            transform: '$.user.contact.email'
      
      # Extract array element
      - id: use-first-address
        operationId: validateAddress
        dependencies: [ step/get-user-profile ]
        inputs:
          address:
            from: step/get-user-profile
            output: profile
            transform: '$.user.addresses[0]'
      
      # Extract specific field from array
      - id: use-address-city
        operationId: lookupWeather
        dependencies: [ step/get-user-profile ]
        inputs:
          city:
            from: step/get-user-profile
            output: profile
            transform: '$.user.addresses[0].city'
      
      # Extract all items matching condition
      - id: use-verified-emails
        operationId: sendBulkEmail
        dependencies: [ step/get-user-profile ]
        inputs:
          recipients:
            from: step/get-user-profile
            output: profile
            transform: '$.contacts[?(@.verified == true)].email'
```

#### 10.4.5 Output Defaults for Optional Data

Handling missing data with default values:

```yaml
workflows:
  optional-data-handling:
    name: 'Handle Optional Response Data'
    steps:
      - id: call-external-api
        operationId: fetchExternalData
        outputs:
          # Required field - fails if missing
          userId:
            source: responseBody
            path: '$.user.id'
          
          # Optional field with default
          displayName:
            source: responseBody
            path: '$.user.displayName'
            default: 'Anonymous'
          
          # Optional nested field
          profilePicture:
            source: responseBody
            path: '$.user.profile.avatar.url'
            default: 'https://cdn.example.com/default-avatar.png'
          
          # Optional header with default
          cacheControl:
            source: responseHeader
            header: 'Cache-Control'
            default: 'no-cache'
          
          # Optional query parameter with default
          returnUrl:
            source: redirectQuery
            parameter: 'return_url'
            default: '/'
      
      - id: use-data
        operationId: processUser
        dependencies: [ step/call-external-api ]
        inputs:
          userId: { from: step/call-external-api, output: userId }
          name: { from: step/call-external-api, output: displayName }
          avatar: { from: step/call-external-api, output: profilePicture }
```

#### 10.4.6 Empty Outputs Object

Step that performs an action but doesn't capture any outputs:

```yaml
workflows:
  fire-and-forget:
    name: 'Action without Output Capture'
    steps:
      - id: trigger-webhook
        operationId: sendWebhook
        inputs:
          event: { const: 'deployment.completed' }
          payload:
            const:
              status: 'success'
              timestamp: '2025-11-26T10:00:00Z'
        # No outputs - just trigger the webhook
      
      - id: log-event
        operationId: writeLog
        dependencies: [ step/trigger-webhook ]
        inputs:
          message: { const: 'Webhook triggered successfully' }
        outputs: {}  # Explicitly empty outputs object
```

#### 10.4.7 Status Code Handling

Capturing and using HTTP status codes:

```yaml
workflows:
  status-code-example:
    name: 'HTTP Status Code Capture'
    steps:
      - id: create-resource
        operationId: createUser
        inputs:
          email: { const: 'user@example.com' }
        outputs:
          userId:
            source: responseBody
            path: '$.id'
          httpStatus:
            source: statusCode
          location:
            source: responseHeader
            header: 'Location'
            default: null
      
      - id: log-creation
        operationId: logEvent
        dependencies: [ step/create-resource ]
        inputs:
          message:
            const: 'User created'
          statusCode: { from: step/create-resource, output: httpStatus }
          resourceId: { from: step/create-resource, output: userId }
```

## 11. Validation Rules

This section defines all validation requirements for workflow definitions, organized by validation layer. Implementations must enforce these rules at the appropriate stage to ensure workflow correctness and prevent runtime errors.

### 11.0 Validation Summary Matrix

Quick reference for implementers showing which validations occur at each layer:

| Section | Validation Rule | Layer | Enforced By |
|---------|-----------------|-------|-------------|
| [11.1.1](#1111-root-object-structure) | Root object structure | Schema | JSON Schema Validator |
| [11.1.2](#1112-schema-version) | `schemaVersion` required and correct value | Schema | JSON Schema Validator |
| [11.1.3](#1113-sourcedescriptions-required) | `sourceDescriptions` required with minimum 1 item | Schema | JSON Schema Validator |
| [11.1.4](#1114-source-name-pattern) | Source description name pattern | Schema | JSON Schema Validator |
| [11.1.5](#1115-workflow-identifier-pattern) | Workflow identifier pattern | Schema | JSON Schema Validator |
| [11.1.6](#1116-step-identifier-pattern) | Step identifier pattern | Schema | JSON Schema Validator |
| [11.1.7](#1117-step-operation-exclusivity) | Step operation exclusivity (operationId XOR method+path XOR workflowRef) | Schema | JSON Schema Validator |
| [11.1.8](#1118-output-field-required-for-step-references) | `output` field required for step references | Schema | JSON Schema Validator |
| [11.1.9](#1119-output-field-forbidden-for-workflow-references) | `output` field forbidden for workflow input references | Schema | JSON Schema Validator |
| [11.1.10](#11110-outputs-forbidden-on-workflowref-steps) | `outputs` forbidden on workflowRef steps | Schema | JSON Schema Validator |
| [11.1.11](#11111-stepoutput-source-specific-required-fields) | StepOutput source-specific required fields | Schema | JSON Schema Validator |
| [11.1.12](#11112-array-uniqueness-constraints) | Dependencies and tags array uniqueness | Schema | JSON Schema Validator |
| [11.1.13](#11113-minimum-steps-required) | Minimum 1 step required | Schema | JSON Schema Validator |
| [11.2.1](#1121-source-name-uniqueness) | Source description name uniqueness | Runtime (Pre) | Workflow Engine |
| [11.2.2](#1122-source-url-accessibility) | Source description URLs are accessible | Runtime (Pre) | Workflow Engine |
| [11.2.3](#1123-step-id-uniqueness) | Step ID uniqueness within workflow | Runtime (Pre) | Workflow Engine |
| [11.2.4](#1124-dependency-references) | Dependency references exist | Runtime (Pre) | Workflow Engine |
| [11.2.5](#1125-circular-step-dependencies) | No circular step dependencies | Runtime (Pre) | Workflow Engine |
| [11.2.6](#1126-circular-workflow-references) | No circular workflow references | Runtime (Pre) | Workflow Engine |
| [11.2.7](#1127-workflow-input-references) | Workflow input references resolve to declared inputs | Runtime (Pre) | Workflow Engine |
| [11.2.8](#1128-step-output-references) | Step output references resolve to declared outputs | Runtime (Pre) | Workflow Engine |
| [11.2.9](#1129-required-input-satisfaction) | All required inputs satisfied | Runtime (Pre) | Workflow Engine |
| [11.2.10](#11210-workflowinput-default-value-validation) | WorkflowInput defaults conform to schema | Runtime (Pre) | Workflow Engine |
| [11.2.11](#11211-openapi-operation-existence) | OpenAPI operation/path exists | Runtime (Pre) | Workflow Engine |
| [11.2.12](#11212-qualified-operation-source-exists) | Qualified operationId source exists | Runtime (Pre) | Workflow Engine |
| [11.2.13](#11213-source-property-validation) | Source property references valid sourceDescription | Runtime (Pre) | Workflow Engine |
| [11.3.1](#1131-output-capture-failure-handling) | Output capture failure without default | Runtime (Exec) | Workflow Engine |
| [11.3.2](#1132-stepoutput-default-type-expectations) | StepOutput default type expectations | Runtime (Exec) | Workflow Engine |

### 11.1 Schema-Level Validation

These validations are enforced by the JSON Schema definition and occur during document parsing/validation.

#### 11.1.1 Root Object Structure

The root object must contain `schemaVersion`, `sourceDescriptions`, and `workflows` properties with no additional properties allowed.

#### 11.1.2 Schema Version

The `schemaVersion` field is required and must have the value `'1.0'`.

```yaml
# ✅ Valid
schemaVersion: '1.0'
sourceDescriptions: [ ... ]
workflows: { ... }

# ❌ Invalid - missing schemaVersion
sourceDescriptions: [ ... ]
workflows: { ... }

# ❌ Invalid - wrong version
schemaVersion: '2.0'
sourceDescriptions: [ ... ]
workflows: { ... }
```

#### 11.1.3 SourceDescriptions Required

The `sourceDescriptions` field is required and must contain at least one source description.

```yaml
# ✅ Valid - single source
schemaVersion: '1.0'
sourceDescriptions:
  - name: user-api
    url: https://api.example.com/users/openapi.yaml
workflows: { ... }

# ✅ Valid - multiple sources
schemaVersion: '1.0'
sourceDescriptions:
  - name: user-api
    url: https://api.example.com/users/openapi.yaml
  - name: order-api
    url: https://api.example.com/orders/openapi.yaml
workflows: { ... }

# ❌ Invalid - missing sourceDescriptions
schemaVersion: '1.0'
workflows: { ... }

# ❌ Invalid - empty array
schemaVersion: '1.0'
sourceDescriptions: []
workflows: { ... }
```

**Rationale:** Without source descriptions, the workflow engine has no way to know which OpenAPI specification(s) to load. This makes workflow documents explicit and self-contained.

#### 11.1.4 Source Name Pattern

Source description `name` values must match: `^[a-zA-Z0-9_-]+$`

Allowed characters: lowercase letters (a-z), uppercase letters (A-Z), digits (0-9), underscore (_), and hyphen (-)

```yaml
# ✅ Valid
sourceDescriptions:
  - name: user-api
    url: https://api.example.com/users/openapi.yaml
  - name: order_service
    url: https://api.example.com/orders/openapi.yaml
  - name: API-v2
    url: https://api.example.com/v2/openapi.yaml

# ❌ Invalid - contains space
sourceDescriptions:
  - name: user api
    url: https://api.example.com/users/openapi.yaml

# ❌ Invalid - contains special characters
sourceDescriptions:
  - name: user.api
    url: https://api.example.com/users/openapi.yaml
  - name: user@api
    url: https://api.example.com/users/openapi.yaml
```

#### 11.1.5 Workflow Identifier Pattern

Workflow identifiers (keys in the `workflows` object) must match: `^[a-zA-Z0-9_.-]+$`

Allowed characters: lowercase letters (a-z), uppercase letters (A-Z), digits (0-9), underscore (_), period (.), and hyphen (-)

```yaml
# ✅ Valid
workflows:
  user-registration: { ... }
  api_v2: { ... }
  oauth2.0: { ... }
  my_workflow: { ... }

# ❌ Invalid - contains space
workflows:
  user registration: { ... }

# ❌ Invalid - contains special characters
workflows:
  user@registration: { ... }
  user/workflow: { ... }
```

#### 11.1.6 Step Identifier Pattern

Step `id` values must match: `^[a-zA-Z0-9_.-]+$`

Allowed characters: lowercase letters (a-z), uppercase letters (A-Z), digits (0-9), underscore (_), period (.), and hyphen (-)

```yaml
# ✅ Valid
- id: create-user
- id: step_1
- id: api.call
- id: process-v2

# ❌ Invalid - contains space
- id: create user

# ❌ Invalid - contains special characters
- id: step:1
- id: create/user
```

**Related Reference Patterns:**

When referencing workflows and steps, these patterns are also enforced:

- **Workflow references**: `^#/workflows/[a-zA-Z0-9_.-]+$`
  - Example: `#/workflows/user-registration`
  
- **Workflow input references**: `^workflow/[a-zA-Z0-9_.-]+$`
  - Example: `workflow/email`, `workflow/api_key`
  
- **Step references**: `^step/[a-zA-Z0-9_.-]+$`
  - Example: `step/create-user`, `step/process-data`

These patterns ensure consistent formatting and enable reliable parsing of references throughout workflow definitions.

#### 11.1.7 Step Operation Exclusivity

Each step must specify exactly one of: `operationId`, `method`+`path`, or `workflowRef`. These are mutually exclusive.

```yaml
# ✅ Valid - operationId only
- id: step1
  operationId: createUser

# ✅ Valid - method + path only
- id: step2
  method: POST
  path: /users

# ✅ Valid - workflowRef only
- id: step3
  workflowRef: '#/workflows/other'

# ❌ Invalid - multiple operation types
- id: step4
  operationId: createUser
  method: POST
```

#### 11.1.8 Output Field Required for Step References

When `from` matches the pattern `^step/`, the `output` field is required.

```yaml
# ✅ Valid - output specified for step reference
inputs:
  userId: { from: step/create-user, output: userId }

# ❌ Invalid - missing output for step reference
inputs:
  userId: { from: step/create-user }

# ✅ Valid - output optional for workflow reference (defaults to input name)
inputs:
  email: { from: workflow/email }
```

#### 11.1.9 Output Field Forbidden for Workflow References

When referencing workflow inputs (`from: workflow/...`), the `output` field must not be present. The step input parameter name (the object key) directly identifies which workflow input to reference.

```yaml
# ✅ Valid - no output field for workflow reference
inputs:
  email: { from: workflow/email }
  config: { from: workflow/appConfig }

# ❌ Invalid - output field not allowed for workflow reference
inputs:
  email: { from: workflow/email, output: email }
```

#### 11.1.10 Auth and Outputs Forbidden on WorkflowRef Steps

Steps using `workflowRef` cannot declare `auth` or `outputs` properties.

**Auth:** `workflowRef` steps don't make HTTP calls, so authentication doesn't apply. The nested workflow's own auth configuration is used for its steps.

**Outputs:** Outputs are inherited from the referenced workflow.

```yaml
# ✅ Valid - no auth or outputs
- id: provision
  workflowRef: '#/workflows/setup'

# ❌ Invalid - auth not allowed
- id: provision
  workflowRef: '#/workflows/setup'
  auth:
    type: bearer
    token: { from: workflow/token }

# ❌ Invalid - outputs not allowed
- id: provision
  workflowRef: '#/workflows/setup'
  outputs:
    result: { source: responseBody, path: '$.data' }
```

#### 11.1.11 StepOutput Source-Specific Required Fields

Different `source` types require specific additional fields:

- `redirectQuery` requires `parameter`
- `responseBody` requires `path`
- `responseHeader` requires `header`
- `statusCode` requires no additional fields

```yaml
# ✅ Valid - redirectQuery with parameter
outputs:
  code: { source: redirectQuery, parameter: code }

# ❌ Invalid - redirectQuery missing parameter
outputs:
  code: { source: redirectQuery }
```

#### 11.1.12 Array Uniqueness Constraints

- Step `dependencies` array must contain unique items
- Step `tags` array must contain unique items

```yaml
# ✅ Valid
dependencies: [ step/a, step/b, step/c ]

# ❌ Invalid - duplicate dependency
dependencies: [ step/a, step/b, step/a ]
```

#### 11.1.13 Minimum Steps Required

Every workflow must have at least one step in the `steps` array.

```yaml
# ✅ Valid
steps:
  - id: step1
    operationId: doSomething

# ❌ Invalid - empty steps array
steps: []
```

### 11.2 Runtime Pre-Execution Validation

These validations occur before workflow execution begins. The workflow engine must build a complete execution plan and verify all references and dependencies are valid.

#### 11.2.1 Step ID Uniqueness

Each step `id` must be unique within a workflow:

```yaml
# ❌ Invalid - duplicate IDs
steps:
  - id: process
    operationId: processA
  - id: process
    operationId: processB
```

```yaml
# ❌ Invalid - duplicate IDs
steps:
  - id: process
    operationId: processA
  - id: process
    operationId: processB
```

#### 11.2.2 Dependency References

Dependencies must reference existing step identifiers using the `step/` prefix:

```yaml
# ❌ Invalid - references non-existent step
steps:
  - id: step1
    operationId: opA
    dependencies: [ step/nonexistent-step ]

# ❌ Invalid - missing step/ prefix
steps:
  - id: step1
    operationId: opA
  - id: step2
    operationId: opB
    dependencies: [ step1 ]  # Should be step/step1
```

**Forward References:** While forward references (referencing steps defined later in the array) are technically allowed since execution engines build complete dependency graphs before execution, they are **strongly discouraged**. Forward references reduce readability and make workflows harder to understand. Best practice is to define steps in topological order, with dependencies appearing before the steps that depend on them.

```yaml
# ⚠️ Allowed but discouraged - forward reference
steps:
  - id: step2
    operationId: opB
    dependencies: [ step/step1 ]  # References step defined later
  
  - id: step1
    operationId: opA

# ✅ Recommended - dependencies defined first
steps:
  - id: step1
    operationId: opA
  
  - id: step2
    operationId: opB
    dependencies: [ step/step1 ]
```

#### 11.2.3 Circular Step Dependencies

Workflows must not contain circular dependencies:

```yaml
# ❌ Invalid - circular dependency
steps:
  - id: step1
    operationId: opA
    dependencies: [ step/step2 ]
  - id: step2
    operationId: opB
    dependencies: [ step/step1 ]
```

#### 11.2.4 Circular Workflow References

Circular workflow references (via `workflowRef`) must be prevented. This validation requires runtime graph traversal and cannot be enforced at the JSON Schema level. Workflow engines must detect and reject workflows that create circular reference chains before execution begins.

```yaml
# ❌ Invalid - circular workflow reference
workflows:
  workflow-a:
    steps:
      - id: call-b
        workflowRef: '#/workflows/workflow-b'
  
  workflow-b:
    steps:
      - id: call-a
        workflowRef: '#/workflows/workflow-a'
```

#### 11.2.5 Workflow Input References

When using `from: workflow/inputName`, the `inputName` must match a key in the workflow's `inputs` object. Runtime engines must validate that all workflow input references resolve to declared inputs.

```yaml
# ❌ Invalid - references undeclared input
workflows:
  example:
    inputs:
      email: { schema: { type: string } }
    steps:
      - id: step1
        operationId: createUser
        inputs:
          email: { from: workflow/undeclared }  # Error: 'undeclared' not in inputs

# ✅ Valid - references declared input
workflows:
  example:
    inputs:
      email: { schema: { type: string } }
    steps:
      - id: step1
        operationId: createUser
        inputs:
          email: { from: workflow/email }
```

#### 11.2.6 Step Output References

When using `from: step/stepId, output: outputName`, the referenced step must declare an output with the specified name. Runtime engines must validate output references against step output declarations.

```yaml
# ❌ Invalid - references undeclared output
steps:
  - id: create-user
    operationId: createUser
    outputs:
      userId: { source: responseBody, path: '$.id' }
  
  - id: send-email
    operationId: sendEmail
    dependencies: [ step/create-user ]
    inputs:
      userId: { from: step/create-user, output: undeclared }  # Error

# ✅ Valid - references declared output
steps:
  - id: create-user
    operationId: createUser
    outputs:
      userId: { source: responseBody, path: '$.id' }
  
  - id: send-email
    operationId: sendEmail
    dependencies: [ step/create-user ]
    inputs:
      userId: { from: step/create-user, output: userId }
```

#### 11.2.7 Required Input Satisfaction

Input references must point to valid workflow inputs or steps with satisfied dependencies:

```yaml
# ❌ Invalid - references step output without dependency
steps:
  - id: step1
    operationId: opA
    inputs:
      value: { from: step/step2, output: result }
  
  - id: step2
    operationId: opB

# ✅ Valid - step2 is a dependency
steps:
  - id: step2
    operationId: opB
    outputs:
      result:
        source: responseBody
        path: '$.value'
  
  - id: step1
    operationId: opA
    dependencies: [ step/step2 ]
    inputs:
      value: { from: step/step2, output: result }
```

#### 11.2.8 WorkflowInput Default Value Validation

The `default` value for workflow inputs must conform to the JSON Schema defined in the `schema` property. Runtime engines must validate default values against their schemas before workflow execution.

```yaml
# ✅ Valid - default matches schema
inputs:
  retryCount:
    schema:
      type: integer
      minimum: 1
    default: 3

# ❌ Invalid - default violates schema constraints
inputs:
  retryCount:
    schema:
      type: integer
      minimum: 1
    default: 0  # Violates minimum: 1
```

#### 11.2.9 OpenAPI Operation Existence

When using `operationId`, the operation must exist in the associated OpenAPI specification. When using `method` + `path`, the path and method combination must exist in the OpenAPI specification.

```yaml
# ✅ Valid - operationId exists in OpenAPI spec
- id: create-user
  operationId: createUser  # Must be defined in OpenAPI spec

# ❌ Invalid - operationId not in OpenAPI spec
- id: create-user
  operationId: nonexistentOperation
```

### 11.3 Runtime Execution Validation

These validations occur during workflow execution and handle dynamic conditions that cannot be determined during pre-execution validation.

#### 11.3.1 Output Capture Failure Handling

When an output cannot be captured from its source and no `default` value is specified, the step must fail:

- **redirectQuery**: Step fails if query parameter is missing from redirect URL
- **responseBody**: Step fails if JSONPath expression doesn't match any data
- **responseHeader**: Step fails if header is not present in response
- **statusCode**: Always succeeds (status codes are always present)

When a `default` value is specified, the output uses the default instead of failing.

```yaml
# Without default - step fails if 'code' parameter missing
outputs:
  authCode:
    source: redirectQuery
    parameter: code

# With default - uses null if parameter missing
outputs:
  optionalCode:
    source: redirectQuery
    parameter: code
    default: null
```

#### 11.3.2 StepOutput Default Type Expectations

The `default` value for step outputs must match the expected type based on the output source. Runtime engines must validate type compatibility during pre-execution validation and reject workflows with incompatible default values.

**Expected types by source:**
- **redirectQuery**: string
- **responseHeader**: string
- **responseBody**: any valid JSON type (depends on JSONPath expression and API response structure)
- **statusCode**: integer

**Validation behavior:**
- Engines should reject workflows where default values have incompatible types (e.g., integer for redirectQuery)
- Type checking should occur during pre-execution validation, not at runtime
- This prevents difficult-to-debug failures when default values are actually used

See [Section 7.2.5](#725-output-capture-behavior) for detailed explanation of output capture behavior, failure modes, and comprehensive examples of default value usage.

## 12. Best Practices

### 12.1 Naming Conventions

- Use kebab-case for workflow identifiers: `user-registration`, `oauth2-flow`
- Use kebab-case for step identifiers: `create-user`, `send-email`, `validate-input`
- Use camelCase for output names: `userId`, `accessToken`, `profileId`

### 12.2 Step Granularity

Keep steps focused on single operations:

```yaml
# ✅ Good - single responsibility
- id: create-user
  operationId: createUser

- id: send-welcome-email
  operationId: sendEmail
  dependencies: [ create-user ]

# ❌ Avoid - trying to do too much in one step
- id: create-user-and-setup-everything
  operationId: createUserWithProfile
```

### 12.3 Input Documentation

Always document inputs with clear descriptions:

```yaml
inputs:
  email:
    description: "User's primary email address used for login and notifications"
    required: true
    schema:
      type: string
      format: email
```

### 12.4 Error Handling

The current specification does **not** include explicit error handling or conditional branching mechanisms. Workflows execute steps linearly based on dependency declarations.

**Current Capabilities:**

You can capture status codes and error information as outputs, but cannot conditionally execute steps based on those values:

```yaml
- id: create-resource
  operationId: createResource
  outputs:
    resourceId:
      source: responseBody
      path: "$.id"
    status:
      source: statusCode
```

**Limitations:**

- **No conditional execution**: All steps with satisfied dependencies will execute
- **No error recovery**: If a step fails, the workflow halts
- **No branching logic**: Cannot choose different execution paths based on runtime values
- **No retry mechanisms**: Failed operations cannot be automatically retried

**Workarounds:**

1. **Default values**: Use the `default` property on outputs to handle missing data gracefully:

   ```yaml
   outputs:
     displayName:
       source: responseBody
       path: '$.user.displayName'
       default: 'Anonymous'
   ```

2. **OpenAPI-level handling**: Implement retry logic, error handling, and conditional behavior within the OpenAPI operations themselves

3. **Workflow composition**: Create separate workflows for different scenarios and invoke them conditionally from orchestration code

**Future Considerations:**

A future version might include:
- Conditional step execution (e.g., `when` or `if` clauses)
- Error handlers (e.g., `onError` steps)
- Retry policies (e.g., `retry` with backoff strategies)
- Try-catch-finally patterns for step groups

### 12.5 Transformation Usage

Use transformations to extract only needed data:

```yaml
# ✅ Good - extract specific field
inputs:
  email:
    from: step/get-profile
    output: profile
    transform: '$.user.contact.email'

# ❌ Avoid - passing entire object when only one field is needed
inputs:
  profile: { from: step/get-profile, output: profile }
```

### 12.6 Injection Attack Prevention

Workflows that process untrusted input or construct dynamic queries must guard against injection attacks:

**Parameter Injection:**
- Always validate workflow inputs against their schemas before execution
- Never construct API endpoints or paths by concatenating untrusted input
- Use parameterized inputs rather than string interpolation

**JSONPath Injection:**
- Be cautious when user input influences JSONPath expressions in transforms
- Validate that JSONPath expressions are well-formed before execution
- Prefer static JSONPath expressions over dynamic construction

**SQL/NoSQL Injection:**
- When workflows interact with databases, ensure the underlying OpenAPI operations use parameterized queries
- Never pass raw user input directly to database operations
- Validate and sanitize all data extracted from previous steps before using in queries

**Best Practice:**
```yaml
# ✅ Good - validated input used in parameterized operation
inputs:
  userId:
    description: 'User ID (validated)'
    required: true
    schema:
      type: string
      pattern: '^[a-zA-Z0-9-]+$'  # Restrict to safe characters

steps:
  - id: get-user
    operationId: getUserById
    inputs:
      userId: { from: workflow/userId }  # Safe - validated against pattern
```

## 13. Integration with OpenAPI 2.0

### 13.1 Operation Resolution

When using `operationId`:
- The workflow engine resolves the operation by matching against OpenAPI 2.0 definitions
- The `operationId` must exist in the OpenAPI spec

When using `method` + `path`:
- The workflow engine matches the method and path template
- Path parameters are substituted from step inputs

### 13.2 Parameter Mapping

Step inputs map to OpenAPI parameters:

```yaml
# OpenAPI 2.0 operation definition
/users/{userId}:
  get:
    operationId: getUserById
    parameters:
      - name: userId
        in: path
        required: true
        type: string

# Workflow definition
workflows:
  get-user-by-id:
    name: 'Get User By ID'
    description: 'Retrieves a user by their unique identifier'
    inputs:
      userId:                                # Workflow input matching OpenAPI path parameter
        description: 'Unique identifier for the user'
        required: true
        schema:
          type: string
    steps:
      - id: get-user
        operationId: getUserById
        inputs:
          userId: { from: workflow/userId }  # Maps workflow input to OpenAPI parameter
```

### 13.3 Request Body Handling

For operations with request bodies:

```yaml
# OpenAPI 2.0 operation
/users:
  post:
    operationId: createUser
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          properties:
            email:
              type: string
            name:
              type: string

# Workflow definition with inputs and step
workflows:
  user-registration:
    name: 'User Registration'
    description: 'Creates a user using the OpenAPI request body schema'
    inputs:
      email:                                 # Workflow input for email field in request body
        description: 'User email address'
        required: true
        schema:
          type: string
          format: email
      name:                                  # Workflow input for name field in request body
        description: "User's full name"
        required: true
        schema:
          type: string
    steps:
      - id: create-user
        operationId: createUser
        inputs:
          email: { from: workflow/email }    # Maps to request body field
          name: { from: workflow/name }      # Maps to request body field
```

## 14. Execution Model

### 14.1 Pre-Execution Validation

Before executing a workflow, the engine must perform recursive validation:

1. **Input Resolution**: Recursively traverse all steps, including nested `workflowRef` steps, to collect all required inputs
2. **Input Satisfaction Check**: Verify that all required inputs can be satisfied either by:
   - Workflow-level inputs (`workflow/` references)
   - Step outputs from dependencies (`step/` references with valid dependency declarations)
   - Literal values (`const` inputs)
3. **Output Contract Validation**: For each `workflowRef` step, resolve the referenced workflow's outputs to determine what outputs will be available
4. **Circular Reference Detection**: Ensure no workflow references create circular dependencies (workflow A → workflow B → workflow A)
5. **Dependency Graph Construction**: Build a complete execution plan accounting for both step-level dependencies and data flow requirements

**Example:**

Given this workflow definition:

```yaml
workflows:
  user-registration:
    name: 'User Registration'
    inputs:
      email:
        required: true
        schema:
          type: string
          format: email
      name:
        required: true
        schema:
          type: string
    
    steps:
      - id: create-user
        operationId: createUser
        inputs:
          email: { from: workflow/email }
          name: { from: workflow/name }
        outputs:
          userId:
            source: responseBody
            path: '$.user.id'
      
      - id: create-profile
        operationId: createUserProfile
        dependencies: [ step/create-user ]
        inputs:
          userId: { from: step/create-user, output: userId }
          email: { from: workflow/email }
        outputs:
          profileId:
            source: responseBody
            path: '$.profile.id'
      
      - id: send-welcome
        operationId: sendEmail
        dependencies: [ step/create-user ]
        inputs:
          to: { from: workflow/email }
          userId: { from: step/create-user, output: userId }
    
    outputs:
      userId:
        from: step/create-user
        output: userId
      profileId:
        from: step/create-profile
        output: profileId
```

When executing `user-registration`, the engine performs pre-execution validation:

1. **Input Resolution**: Identifies required workflow inputs (`email`, `name`)
2. **Step 1 Validation** (`create-user`):
   - No dependencies, can execute first
   - Inputs satisfied by workflow inputs: `workflow/email`, `workflow/name`
   - Will produce output: `userId`
3. **Step 2 Validation** (`create-profile`):
   - Depends on `step/create-user` (valid dependency)
   - Input `userId` satisfied by `step/create-user` output
   - Input `email` satisfied by `workflow/email`
   - Will produce output: `profileId`
4. **Step 3 Validation** (`send-welcome`):
   - Depends on `step/create-user` (valid dependency)
   - Inputs `to` and `userId` can be satisfied
   - Can run in parallel with `create-profile` after `create-user` completes
5. **Execution Plan**: `create-user` → (`create-profile` ∥ `send-welcome`)

This validation ensures all data dependencies are satisfied before execution begins.

### 14.2 Execution Order

1. Workflow inputs are validated against schemas
2. Steps without dependencies execute first
3. Each step waits for all dependencies to complete
4. Steps with satisfied dependencies may execute in parallel
5. Workflow outputs are assembled from completed steps

### 14.3 Data Flow

```
Workflow Inputs
     ↓
   Step 1 (no dependencies)
     ↓
  [outputs]
     ↓
   Step 2 (depends on Step 1)
     ↓
  [outputs]
     ↓
Workflow Outputs
```

### 14.4 Parallel Execution

Steps without mutual dependencies can execute in parallel:

```yaml
steps:
  - id: init
    operationId: initialize
  
  # These three can run in parallel after init
  - id: task-a
    operationId: taskA
    dependencies: [ step/init ]
  
  - id: task-b
    operationId: taskB
    dependencies: [ step/init ]
  
  - id: task-c
    operationId: taskC
    dependencies: [ step/init ]
  
  # Waits for all three to complete
  - id: finalize
    operationId: finalize
    dependencies: [ step/task-a, step/task-b, step/task-c ]
```

## 15. Versioning and Migration

### 15.1 Deprecation Strategy

When deprecating workflows:

```yaml
workflows:
  old-workflow:
    name: 'Old Workflow'
    deprecation:
      deprecated: true
      replacedBy: '#/workflows/new-workflow'
    steps: [ ... ]
  
  new-workflow:
    name: 'New Workflow'
    description: 'Replaces old-workflow with improved error handling'
    steps: [ ... ]
```

### 15.2 Breaking Changes

Breaking changes include:
- Removing required workflow inputs
- Changing workflow output structure
- Removing workflow outputs
- Changing step execution order in ways that affect side effects

Non-breaking changes:
- Adding optional workflow inputs
- Adding new workflow outputs
- Adding new steps that don't affect existing outputs
- Adding step descriptions or tags

## 16. Security Considerations

### 16.1 Sensitive Data

#### 16.1.1 Marking Sensitive Outputs

Use the `sensitive` property to mark outputs containing confidential data. This ensures workflow engines automatically mask these values in logs, error messages, and debugging output.

**Always mark these as sensitive:**

```yaml
outputs:
  # Authentication tokens
  accessToken:
    source: responseBody
    path: '$.access_token'
    sensitive: true  # ✅ Required
  
  refreshToken:
    source: responseBody
    path: '$.refresh_token'
    sensitive: true  # ✅ Required
  
  # API keys and secrets
  apiKey:
    source: responseBody
    path: '$.api_key'
    sensitive: true  # ✅ Required
  
  # Passwords
  temporaryPassword:
    source: responseBody
    path: '$.temp_password'
    sensitive: true  # ✅ Required
  
  # Session identifiers
  sessionId:
    source: responseHeader
    header: Set-Cookie
    sensitive: true  # ✅ Required
```

**Implementation Requirements:**

Workflow engines must implement the following security measures for outputs marked `sensitive: true`:

1. **Log Masking**: Replace actual values with `**REDACTED**` or similar placeholder in all log output
2. **Error Message Sanitization**: Exclude sensitive values from exception messages and stack traces
3. **Debug Output Protection**: Hide or obfuscate sensitive values in development tools and debuggers
4. **Audit Trail Privacy**: Hash or omit sensitive values from audit logs and compliance records

**Example with proper masking:**

```yaml
workflows:
  secure-login:
    steps:
      - id: authenticate
        operationId: login
        outputs:
          token:
            source: responseBody
            path: '$.access_token'
            sensitive: true
          
          userId:
            source: responseBody
            path: '$.user_id'
            # Not sensitive - public identifier

# Execution log output:
# [2025-11-27 10:30:45] Step 'authenticate' completed
# [2025-11-27 10:30:45] Output 'token': **REDACTED**
# [2025-11-27 10:30:45] Output 'userId': 'user-12345'
```

#### 16.1.2 Marking Workflow Inputs as Sensitive

Always mark workflow inputs containing credentials or secrets as sensitive:

```yaml
workflows:
  secure-workflow:
    inputs:
      # ✅ Sensitive inputs properly marked
      password:
        description: 'User password'
        required: true
        schema: { type: string, format: password }
        sensitive: true  # Required for passwords
      
      apiKey:
        description: 'API authentication key'
        required: true
        schema: { type: string }
        sensitive: true  # Required for API keys
      
      encryptionSecret:
        description: 'Data encryption secret'
        required: true
        schema: { type: string }
        sensitive: true  # Required for secrets
      
      # ✅ Non-sensitive inputs not marked
      username:
        description: 'User login name'
        required: true
        schema: { type: string }
        # No sensitive flag - usernames are typically not secret
      
      email:
        description: 'User email address'
        required: true
        schema: { type: string, format: email }
        # No sensitive flag - emails are not secret
```

When a workflow input is marked `sensitive: true`, any step input that references it is automatically treated as sensitive throughout the workflow execution.

#### 16.1.3 Avoiding Hardcoded Secrets

Never hardcode sensitive data in workflow definitions:

```yaml
# ❌ Avoid - secrets exposed in workflow definition
steps:
  - id: call-api
    operationId: getData
    inputs:
      apiKey: { const: 'sk_live_123456...' }  # ❌ Never do this

# ✅ Better - accept as workflow input with sensitive flag
workflows:
  api-workflow:
    inputs:
      apiKey:
        description: 'API key for authentication'
        required: true
        schema:
          type: string
          format: password
        sensitive: true  # Mark workflow input as sensitive
    
    steps:
      - id: call-api
        operationId: getData
        inputs:
          apiKey: { from: workflow/apiKey }  # Automatically treated as sensitive
```

**Best Practices:**

1. **Use Environment Variables**: Pass secrets via workflow inputs that are populated from secure environment variables
2. **Temporary Credentials**: Use short-lived tokens that automatically expire
3. **Principle of Least Privilege**: Only request the minimum required permissions

#### 16.1.4 Sensitive Workflow Outputs

When exposing sensitive data at the workflow level, always mark it as sensitive:

```yaml
workflows:
  authentication:
    steps:
      - id: login
        operationId: authenticate
        outputs:
          token:
            source: responseBody
            path: '$.token'
            sensitive: true
    
    outputs:
      # ✅ Properly marked as sensitive at workflow level
      accessToken:
        from: step/login
        output: token
        sensitive: true  # Required for tokens
```

This signals to consumers and orchestration systems that the output requires secure handling.

### 16.2 Authorization

Workflow execution should enforce:

- **Authorization checks before executing operations**: Workflow engines should verify that the workflow executor has appropriate permissions to invoke each operation. This includes checking API-level permissions, resource access rights, and scope-based authorization where applicable.

- **Validation of workflow input parameters**: All workflow inputs should be validated against their declared schemas before execution begins. This prevents injection attacks and ensures data integrity. Consider implementing additional business-level validation rules beyond basic type checking.

- **Sanitization of data passed between steps**: Data flowing between steps should be sanitized to prevent injection attacks, especially when constructing dynamic queries or commands. Be particularly careful with data extracted via JSONPath transformations that may be used in subsequent API calls.

## 17. Tooling and Validation

### 17.1 JSON Schema Validation

All workflow definitions must validate against the provided JSON Schema (`schema.yaml`).

### 17.2 Static Analysis

Recommended static checks:
- Step ID uniqueness
- Dependency graph validation (no cycles)
- Reference validity (all `from` references exist)
- Output reference validity
- Pattern compliance for identifiers

### 17.3 Runtime Validation

Before execution:
- Validate workflow inputs against schemas
- Verify OpenAPI operation existence
- Check parameter compatibility

### 17.4 Implementation Guidance

**For Workflow Engine Implementers:**

- **Validation Order**: Perform schema validation first (cheapest), then static analysis (moderate cost), then runtime validation (most expensive). Fail fast to provide quick feedback.

- **Dependency Resolution**: Build a complete dependency graph before execution. Use topological sorting to determine execution order and detect circular dependencies early.

- **Caching**: Cache loaded OpenAPI specifications and parsed workflow definitions to improve performance. Invalidate caches when source files change.

- **Error Messages**: Provide clear, actionable error messages with line numbers, property paths, and specific validation failures. Include suggestions for fixes when possible.

- **Parallel Execution**: Identify steps with no mutual dependencies and execute them concurrently when safe to do so. Respect step dependencies strictly to maintain data flow correctness.

## 18. Glossary

- **Workflow**: Ordered sequence of steps that execute API operations
- **Step**: Atomic unit of workflow execution
- **Input Reference**: Pointer to workflow input or step output
- **Output Reference**: Named alias exposing step output at workflow level
- **Dependency**: Constraint requiring one step to complete before another
- **Transform**: JSONPath expression for data extraction/reshaping
- **WorkflowRef**: Reference to another workflow for composition
- **operationId**: Unique identifier for an OpenAPI operation
- **Source Description**: Root-level registry entry defining an OpenAPI specification with a unique name, enabling multi-API orchestration
- **Qualified Operation Reference**: Notation format `source-name.operationId` that explicitly specifies which API contains an operation when multiple APIs are registered
- **Source Property**: Step property that specifies which API source to use when referencing operations via method+path in multi-API scenarios
- **Sensitive Data**: Data marked with `sensitive: true` (on inputs, outputs, or literals) that contains confidential information (passwords, tokens, API keys, secrets) requiring masking in logs, error messages, and debugging output
- **Implicit Sensitivity**: Automatic treatment of authentication fields (username, password, token, value) as sensitive without explicit flags

## 19. Appendix

### 19.1 JSONPath Reference

Common JSONPath expressions used in transforms:

- `$.field` - Extract top-level field
- `$.nested.field` - Extract nested field
- `$[0]` - First array element
- `$[-1]` - Last array element
- `$[*].field` - All fields from array elements
- `$.concat('prefix-', $.field)` - String concatenation

### 19.2 HTTP Methods

Supported HTTP methods for `method` property:
- GET - Retrieve resource
- POST - Create resource
- PUT - Replace resource
- PATCH - Update resource
- DELETE - Remove resource
- HEAD - Retrieve headers only
- OPTIONS - Get supported methods

### 19.3 Complete Schema Summary

```
Root
├── schemaVersion (string) *required
├── sourceDescriptions (array) [optional]
│   └── SourceDescription
│       ├── name (string) *required
│       ├── url (string) *required
│       └── description (string)
└── workflows (object) *required
    └── {workflow-id} (Workflow)
        ├── name (string)
        ├── description (string)
        ├── inputs (object)
        │   └── {input-name} (WorkflowInput)
        │       ├── description (string)
        │       ├── required (boolean)
        │       ├── schema (object)
        │       ├── default (any)
        │       └── sensitive (boolean)
        ├── steps (array) *required
        │   └── Step
        │       ├── id (string) *required
        │       ├── description (string)
        │       ├── operationId | (method + path + source) | workflowRef *one required
        │       ├── dependencies (array of string)
        │       ├── inputs (object)
        │       │   └── {input-name}: StepInputLiteral | StepInputReference
        │       │       StepInputLiteral:
        │       │         ├── const *required
        │       │         └── sensitive (boolean)
        │       │       StepInputReference:
        │       │         ├── from *required
        │       │         ├── output (conditional)
        │       │         └── transform (string)
        │       ├── outputs (object)
        │       │   └── {output-name} (StepOutput)
        │       │       ├── source *required
        │       │       ├── parameter (if source=redirectQuery)
        │       │       ├── path (if source=responseBody)
        │       │       ├── header (if source=responseHeader)
        │       │       ├── default (any)
        │       │       └── sensitive (boolean)
        │       └── tags (array of string)
        ├── outputs (object)
        │   └── {output-name} (WorkflowOutput)
        │       ├── from *required
        │       ├── output *required
        │       └── sensitive (boolean)
        └── deprecation (Deprecation)
            ├── deprecated (boolean)
            └── replacedBy (WorkflowReference)
```

---

**End of Specification**