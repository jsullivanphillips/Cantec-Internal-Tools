# Cantec Fire Alarms' Battery Capacity Calculator
 
## Specification Document
 
---
 
## 1. Purpose
 
This component provides a technician-facing battery capacity calculator for use on iPads and mobile devices. It calculates the required system battery capacity for entry into **22.5(p) of the CAN/ULC S536-19 Report**.
 
- Standalone component
- No external integrations required
 
---
 
## 2. Implementation Target
 
- **Framework:** React
- **Architecture:** Single component
- **CSS:** Reuse existing styles exactly
- **Persistence:** Values remain until Reset is pressed
- **Defaults:**
  - Blank inputs = 0
  - Derating factor default = 1.2
  - Battery logic = **series only (fixed)**
- **Excluded features:**
  - Copy summary
  - Future expansion
 
---
 
## 3. Header Content
 
### Title
Cantec Fire Alarms' Battery Capacity Calculator
 
### Subtitle
Use this calculator to determine the required system battery capacity in Ah for entry into 22.5(p) of the CAN/ULC S536-19 Report
 
---
 
## 4. UI / UX Requirements
 
- Maintain **horizontal formula layout at all screen sizes**
- Do NOT collapse rows vertically
- Keep math symbols visible (×, +, =)
- Center-align all inputs and outputs
- Keep labels to one line where possible
- Optimize for iPad/mobile use
 
---
 
## 5. Functional Sections
 
### 5.1 Supervisory Calculation
 
**Formula Layout:**  
[Supervisory Current] × [Supervisory Requirement] = [Total Supervisory Ah]
 
**Inputs:**
- Supervisory Current (A)
- Supervisory Requirement:
  - 24 hrs = 24
  - 4 hrs = 4
 
**Formula:**
```
supervisoryAh = current × hours
```
 
---
 
### 5.2 Full Load Requirements
 
**Formula Layout:**  
[Full Load Current] × [Alarm Requirement] = [Total Full Load Ah]
 
**Inputs:**
- Full Load Current (A)
- Alarm Requirement:
  - 5 min (0.0833 h)
  - 30 min (0.5 h)
  - 1 hr (1.0 h)
  - 2 hr (2.0 h)
 
**Formula:**
```
fullLoadAh = current × hours
```
 
---
 
### 5.3 Subtotal (Before Derating)
 
**Formula Layout:**  
[Supervisory Ah] + [Full Load Ah] = [Subtotal Ah]
 
```
subtotalAh = supervisoryAh + fullLoadAh
```
 
---
 
### 5.4 Final (After Derating)
 
**Formula Layout:**  
[Subtotal Ah] × [Derating Factor] = [Final Ah]
 
- Default derating factor: **1.2**
 
```
finalAh = subtotalAh × deratingFactor
```
 
Helper text:
> 20% is typical (1.2)
 
---
 
### 5.5 Installed Battery Calculation
 
**Inputs:**
- Quantity
- Voltage (6V / 12V / 24V)
- Ah rating
 
**Logic (Series Only):**
```
if qty <= 0 or ah <= 0 → 0
if 24V → Ah
if 12V or 6V:
  if qty ≥ 2 → Ah
  else → 0
```
 
---
 
### 5.6 Comparison
 
Outputs:
- Calculated Requirement
- Installed Battery Set
- Difference
 
```
difference = installed - required
```
 
---
 
### 5.7 PASS / FAIL Logic
 
```
PASS if installed ≥ required AND required > 0
else FAIL
```
 
---
 
## 6. Explanatory Material
 
"Derating factor": Otherwise known as a Safety Factor, is a multiplier used to reduce the usable capacity of a battery to account for real-world conditions.
 
20% is typical (1.2).
 
Examples of real-world conditions include:
- temperature changes
- battery aging
- discharge under load
- charger tolerance
- performance degradation over time
 
**Acceptance criteria:**
- Installed Ah ≥ Required Ah
- Battery type/size acceptable for system
 
---
 
## 7. Reset Behavior
 
Reset sets:
- Supervisory Current → blank
- Supervisory Requirement → 24
- Full Load Current → blank
- Alarm Requirement → 0.5
- Derating Factor → 1.2
- Battery Qty → blank
- Battery Voltage → 12V
- Battery Ah → blank
 
---
 
## 8. Formatting Rules
 
- Blank = 0
- Display format:
```
value.toFixed(2) + " Ah"
```
 
---
 
## 9. Live Calculation
 
Recalculate on any input change.
 
---
 
## 10. Key Constraint
 
⚠️ Battery logic MUST assume **series configuration only** (fire alarm standard).
 
- Voltage adds
- Ah does NOT increase
 
---
 
## 11. Deliverable
 
- Single React component
- Exact UI replication
- Uses existing CSS
- No additional features
 
---
 
End of Specification