# ==================================================
# 🔍 GOOGLE ADS API DIAGNOSTIC (POWERSHEET / NO NODE DEPENDENCY)
# Runs directly in Windows PowerShell without requiring Node.js or npm install.
# ==================================================

$ErrorActionPreference = "Stop"

function Mask-String($str) {
    if (-not $str) { return "NOT_SET" }
    if ($str.Length -le 8) { return "********" }
    return $str.Substring(0, 4) + "..." + $str.Substring($str.Length - 4)
}

function Normalize-Digits($str) {
    if (-not $str) { return "" }
    return $str -replace '\D', ''
}

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "🔍 GOOGLE ADS API DIAGNOSTIC (POWERSHELL)" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Load .env file
$config = @{}
if (Test-Path ".env") {
    Write-Host "📖 Loading .env file..." -ForegroundColor Gray
    Get-Content ".env" | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $parts = $line -split '=', 2
            if ($parts.Length -eq 2) {
                $key = $parts[0].Trim()
                $val = $parts[1].Trim()
                # Remove quotes if present
                $val = $val -replace '^["'']|["'']$', ''
                $config[$key] = $val
            }
        }
    }
} else {
    Write-Host "⚠️ Warning: .env file not found in current directory." -ForegroundColor Yellow
}

# Apply to environment just in case
foreach ($key in $config.Keys) {
    [System.Environment]::SetEnvironmentVariable($key, $config[$key])
}

$clientId = $config["CLIENT_ID"]
$clientSecret = $config["CLIENT_SECRET"]
$refreshToken = $config["REFRESH_TOKEN"]
$developerToken = $config["DEVELOPER_TOKEN"]
$mccId = Normalize-Digits $config["MCC_ID"]
$mccFallback1 = Normalize-Digits $config["MCC_FALLBACK_1"]
$mccFallback2 = Normalize-Digits $config["MCC_FALLBACK_2"]

# Check required variables
$missing = @()
if (-not $clientId) { $missing += "CLIENT_ID" }
if (-not $clientSecret) { $missing += "CLIENT_SECRET" }
if (-not $refreshToken) { $missing += "REFRESH_TOKEN" }
if (-not $developerToken) { $missing += "DEVELOPER_TOKEN" }

Write-Host "📋 Checking Variables:" -ForegroundColor Gray
Write-Host "  CLIENT_ID:        $(Mask-String $clientId)"
Write-Host "  CLIENT_SECRET:    $(Mask-String $clientSecret)"
Write-Host "  REFRESH_TOKEN:    $(Mask-String $refreshToken)"
Write-Host "  DEVELOPER_TOKEN:  $(Mask-String $developerToken)"
Write-Host "  MCC_ID:           $($mccId ? $mccId : 'NOT_SET')"
Write-Host "  MCC_FALLBACK_1:   $($mccFallback1 ? $mccFallback1 : 'NOT_SET')"
Write-Host "  MCC_FALLBACK_2:   $($mccFallback2 ? $mccFallback2 : 'NOT_SET')"
Write-Host ""

if ($missing.Count -gt 0) {
    Write-Host "❌ Error: Missing critical variables: $($missing -join ', ')" -ForegroundColor Red
    Write-Host "Please edit your .env file and fill in these values." -ForegroundColor Yellow
    exit 1
}

# 2. Get Access Token from OAuth 2.0
Write-Host "🔑 Validating OAuth Credentials with Google API..." -ForegroundColor Gray
$accessToken = ""
$tokenOwnerEmail = "Unknown"
try {
    $body = @{
        client_id     = $clientId
        client_secret = $clientSecret
        refresh_token = $refreshToken
        grant_type    = "refresh_token"
    }
    
    $tokenRes = Invoke-RestMethod -Uri "https://oauth2.googleapis.com/token" -Method Post -Body $body
    $accessToken = $tokenRes.access_token
    Write-Host "  ✅ Refresh Token is VALID. Successfully generated Access Token." -ForegroundColor Green
    
    # Fetch token email
    try {
        $infoRes = Invoke-RestMethod -Uri "https://oauth2.googleapis.com/tokeninfo?access_token=$accessToken" -Method Get
        $tokenOwnerEmail = $infoRes.email
        $scopes = $infoRes.scope
        Write-Host "  👤 Authenticated Account Email: $tokenOwnerEmail" -ForegroundColor White
        Write-Host "  🌐 Scopes Granted: $scopes" -ForegroundColor White
    } catch {
        Write-Host "  ⚠️ Could not fetch token email owner info." -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ❌ Google refresh token validation failed!" -ForegroundColor Red
    $errMessage = $_.Exception.Message
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $errMessage = $reader.ReadToEnd()
    }
    Write-Host "  Details: $errMessage" -ForegroundColor Red
    Write-Host ""
    Write-Host "💡 Recommendation: Generate a new Refresh Token using the correct Client ID and Client Secret." -ForegroundColor Yellow
    exit 1
}
Write-Host ""

# 3. Fetch Accessible Customers
Write-Host "🔌 Testing Google Ads API connectivity..." -ForegroundColor Gray
$accessibleIds = @()
try {
    $headers = @{
        "Authorization" = "Bearer $accessToken"
        "developer-token" = $developerToken
    }
    
    $accessibleRes = Invoke-RestMethod -Uri "https://googleads.googleapis.com/v17/customers:listAccessibleCustomers" -Method Get -Headers $headers
    
    $accessibleIds = $accessibleRes.resourceNames | ForEach-Object { $_ -replace 'customers/', '' }
    Write-Host "  ✅ Successfully called listAccessibleCustomers." -ForegroundColor Green
    Write-Host "  🔍 Customers directly accessible by this Refresh Token ($($accessibleIds.Count) found):" -ForegroundColor Gray
    if ($accessibleIds.Count -gt 0) {
        foreach ($id in $accessibleIds) {
            Write-Host "     - Customer ID: $id" -ForegroundColor White
        }
    } else {
        Write-Host "     (No direct customer links. This token only has access through manager linkages or needs setup)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ❌ Failed to list accessible customers!" -ForegroundColor Red
    $errMessage = $_.Exception.Message
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $errMessage = $reader.ReadToEnd()
    }
    Write-Host "  Details: $errMessage" -ForegroundColor Red
    Write-Host ""
    Write-Host "💡 Recommendation: Check if your Developer Token is valid, active, and approved for use." -ForegroundColor Yellow
    exit 1
}
Write-Host ""

# 4. Target Customer ID to test
$targetCustomerId = ""
if ($args.Count -gt 0) {
    $targetCustomerId = Normalize-Digits $args[0]
}

if (-not $targetCustomerId) {
    Write-Host "❓ No target Customer ID provided." -ForegroundColor Yellow
    Write-Host "Usage: .\tools\diagnose-google-ads.ps1 <CUSTOMER_ID_TO_TEST>" -ForegroundColor Cyan
    Write-Host "Example: .\tools\diagnose-google-ads.ps1 1234567890" -ForegroundColor Cyan
    Write-Host ""
    
    # Try reading first Google Customer ID from Sheets if spreadsheet ID is set
    $spreadsheetId = $config["SPREADSHEET_ID"]
    if ($spreadsheetId) {
        Write-Host "📖 spreadsheetId found in .env, but spreadsheet reading requires node/googleapis which is missing." -ForegroundColor Gray
    }
    exit 0
}

if ($targetCustomerId.Length -ne 10) {
    Write-Host "❌ Error: Customer ID must be exactly 10 digits. Provided: $targetCustomerId" -ForegroundColor Red
    exit 1
}

# 5. Query testing
Write-Host "🧪 Testing access for Customer ID: $targetCustomerId" -ForegroundColor Gray
Write-Host ""

$mccs = @()
if ($mccId) { $mccs += $mccId }
if ($mccFallback1) { $mccs += $mccFallback1 }
if ($mccFallback2) { $mccs += $mccFallback2 }

# Unique list of MCCs
$mccList = $mccs | Select-Object -Unique

$attempts = @()
foreach ($mcc in $mccList) {
    $attempts += @{ name = "MCC $mcc"; id = $mcc }
}
$attempts += @{ name = "Direct (No MCC)"; id = $null }

Write-Host "Available login-customer-ids (MCC IDs) to try: [$($mccList -join ', ')] and Direct" -ForegroundColor Gray
Write-Host "--------------------------------------------------" -ForegroundColor Gray

$hasSuccess = $false
$successfulMcc = ""

foreach ($attempt in $attempts) {
    $attemptName = $attempt.name
    $attemptId = $attempt.id
    
    $headers = @{
        "Authorization" = "Bearer $accessToken"
        "developer-token" = $developerToken
        "Content-Type" = "application/json"
    }
    if ($attemptId) {
        $headers["login-customer-id"] = $attemptId
    }
    
    # Lightweight query payload
    $queryBody = @{
        query = "SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1"
    } | ConvertTo-Json
    
    try {
        $res = Invoke-RestMethod -Uri "https://googleads.googleapis.com/v17/customers/$targetCustomerId/googleAds:search" -Method Post -Headers $headers -Body $queryBody
        Write-Host "  🟢 [SUCCESS] Authenticated via $attemptName" -ForegroundColor Green
        $hasSuccess = $true
        $successfulMcc = $attemptName
        break
    } catch {
        $errMessage = $_.Exception.Message
        if ($_.Exception.Response) {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $raw = $reader.ReadToEnd()
            if ($raw -like "*USER_PERMISSION_DENIED*") {
                $errMessage = "USER_PERMISSION_DENIED (User has no access)"
            } elseif ($raw -like "*DEVELOPER_TOKEN_INVALID*") {
                $errMessage = "DEVELOPER_TOKEN_INVALID"
            } elseif ($raw -like "*CUSTOMER_NOT_FOUND*") {
                $errMessage = "CUSTOMER_NOT_FOUND (ID does not exist)"
            } elseif ($raw -like "*CUSTOMER_NOT_ENABLED*") {
                $errMessage = "CUSTOMER_NOT_ENABLED (Account deactivated)"
            } else {
                $errMessage = $raw.Substring(0, [Math]::Min(120, $raw.Length))
            }
        }
        $attemptLabel = $attemptName.PadRight(18)
        Write-Host "  🔴 [FAILED]  Via $attemptLabel | Error: $errMessage" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "📋 DIAGNOSIS SUMMARY" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "1. OAuth Refresh Token Email: $tokenOwnerEmail"

if ($hasSuccess) {
    Write-Host "🎉 ACCESS GRANTED via $successfulMcc" -ForegroundColor Green
    Write-Host ""
    Write-Host "💡 Solution: If this works locally but fails in production (Vercel)," -ForegroundColor Yellow
    Write-Host "   you need to make sure the exact same variables are set on Vercel" -ForegroundColor Yellow
    Write-Host "   AND you trigger a *Redeploy* of the project on Vercel so they take effect." -ForegroundColor Yellow
} else {
    Write-Host "❌ ACCESS DENIED under all configurations." -ForegroundColor Red
    Write-Host ""
    Write-Host "💡 Resolution Steps:" -ForegroundColor Yellow
    Write-Host "   - Ensure that the user account '$tokenOwnerEmail' has Standard or Admin" -ForegroundColor Yellow
    Write-Host "     access to the MCC managing $targetCustomerId." -ForegroundColor Yellow
    Write-Host "   - Check if you accepted the invitation email on '$tokenOwnerEmail'." -ForegroundColor Yellow
    Write-Host "   - Verify that the MCC ID managing this account is one of these: [$($mccList -join ', ')]" -ForegroundColor Yellow
}
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
