# Mobile robot base — design brief

## Confirmed

- Fabricated metal frame using L-section steel, with removable paneling.
- Battery: 24 V / 50 Ah LiFePO₄, Group 24, advertised 1280 Wh, 50 A BMS and low-temperature cutoff. Exact product not yet identified.
- Include battery restraints, protected electronics mounts, wheel and motor assemblies, motor drivers, control board, regulated supplies, protection and serviceable wiring.
- Separate purchased components into Parts List → McMaster and Electronics, with source links and datasheets.

## Follow-up questions before dimensioning

1. Attach the reference PDF or provide its target footprint, height and clearance.
2. Confirm battery product link, physical dimensions, terminals, full-charge voltage and BMS regenerative-charge behavior. LiFePO₄ identifies chemistry, not the case or mounting dimensions.
3. Specify payload, total loaded mass, slope, terrain, obstacle height and target speed.
4. Confirm runtime, weather exposure and controller/sensor requirements.
5. Confirm steel stock thickness, available fabrication methods and budget.

## Packaging concept

Place the battery low and near the support polygon's center. Use a removable tray with positive lateral stops, padded restraint and insulated terminal clearance. Bolt a separate electronics tray above or beside it, leaving access to disconnects, driver cooling, controller ports, cable service loops and battery removal. Route power and sensitive signals separately. Mount drives on replaceable brackets attached to the steel frame; put removable panels on threaded tabs or rivet nuts. Keep wheel, motor, chassis and panel bodies separately named for joints and later edits.

Size the drivetrain from loaded mass, wheel radius, rolling resistance, grade and acceleration. Choose gearing from target ground speed and loaded motor speed. Check continuous torque and motor/driver thermal limits, startup/stall current, battery/BMS limits and braking behavior before specifying motors, fuses or wire gauges. A 50 A battery BMS is not branch-circuit protection.

## Research references — candidates only

- WattCycle's 24 V 50 Ah Group 24 product lists a 10.24 × 6.61 × 8.35 inch case. This is a possible match, not confirmation of the user's battery: https://www.wattcycle.com/products/24v-50ah-tm-bluetooth-lifepo4-battery-for-70-100lb-trolling-motors
- Dimension Engineering Sabertooth 2x32 driver and manufacturer wiring/manual: https://www.dimensionengineering.com/products/sabertooth2x32 and https://www.dimensionengineering.com/datasheets/Sabertooth2x32.pdf . Compatibility and capacity depend on chosen motors and battery/BMS braking behavior.
- Pololu 24 V 37D encoder gearmotors: https://www.pololu.com/category/272/24v-37d-metal-gearmotors . These are a reference family; do not assume they can drive a loaded steel base without torque/load calculations.

No fabrication-ready dimensions or motor choice are approved from this brief. Final CAD awaits the PDF and load/packaging specifications in Follow-up questions.
