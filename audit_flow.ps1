$jsonPath = Join-Path $PSScriptRoot "public\data\licencias_data.json"
$raw = [System.IO.File]::ReadAllText($jsonPath, [System.Text.Encoding]::UTF8)
$data = ConvertFrom-Json $raw

Write-Host "================ AUDITORIA DE FLUJO DE LICENCIAS ================"
Write-Host "Total predios en dataset unificado:" $data.Count

$f1Stayed = ($data | Where-Object { $_.fase -eq 1 }).Count
$f2Stayed = ($data | Where-Object { $_.fase -eq 2 }).Count
$f3Stayed = ($data | Where-Object { $_.fase -eq 3 }).Count

Write-Host "`n--- ESTADO ESTACIONARIO ACTUAL (Donde se detuvo el predio) ---"
Write-Host "Predios parados actualmente en Fase 1 (EC):" $f1Stayed
Write-Host "Predios parados actualmente en Fase 2 (AZ):" $f2Stayed
Write-Host "Predios parados actualmente en Fase 3 (AMC):" $f3Stayed
Write-Host "Suma de los 3 estados:" ($f1Stayed + $f2Stayed + $f3Stayed)

$in_ec = ($data | Where-Object { $_.in_ec -eq $true }).Count
$in_az = ($data | Where-Object { $_.in_az -eq $true }).Count
$in_amc = ($data | Where-Object { $_.in_amc -eq $true }).Count

Write-Host "`n--- VOLUMEN ACUMULADO QUE ENTRO A CADA FASE (Embudo Real) ---"
Write-Host "Total que ingreso a Fase 1 (Entidades Colaboradoras):" $in_ec
Write-Host "Total que ingreso a Fase 2 (Administraciones Zonales):" $in_az
Write-Host "Total que ingreso a Fase 3 (Control Posterior AMC):" $in_amc

$ec_only = ($data | Where-Object { $_.in_ec -eq $true -and $_.in_az -ne $true -and $_.in_amc -ne $true }).Count
$ec_and_az = ($data | Where-Object { $_.in_ec -eq $true -and $_.in_az -eq $true -and $_.in_amc -ne $true }).Count
$az_only = ($data | Where-Object { $_.in_ec -ne $true -and $_.in_az -eq $true -and $_.in_amc -ne $true }).Count
$az_and_amc_no_ec = ($data | Where-Object { $_.in_ec -ne $true -and $_.in_az -eq $true -and $_.in_amc -eq $true }).Count
$ec_and_amc_no_az = ($data | Where-Object { $_.in_ec -eq $true -and $_.in_az -ne $true -and $_.in_amc -eq $true }).Count
$all_three = ($data | Where-Object { $_.in_ec -eq $true -and $_.in_az -eq $true -and $_.in_amc -eq $true }).Count
$amc_only = ($data | Where-Object { $_.in_ec -ne $true -and $_.in_az -ne $true -and $_.in_amc -eq $true }).Count

Write-Host "`n--- INTERSECCION DETALLADA (DIAGRAMA DE VENN) ---"
Write-Host "1. Solo entraron a EC y NUNCA pasaron a AZ (Estancados en F1):" $ec_only
Write-Host "2. Entraron a EC y SI avanzaron a AZ (en tramite AZ, sin AMC):" $ec_and_az
Write-Host "3. Entraron directo a AZ sin pasar por EC (p.ej. LMU 10 de suelo o regularizaciones):" $az_only
Write-Host "4. Trazabilidad completa (EC -> AZ -> AMC con registro en los 3):" $all_three
Write-Host "5. Directo AZ con control AMC posterior (AZ -> AMC sin EC previa):" $az_and_amc_no_ec
Write-Host "6. EC con certificado AMC (sin fecha registrada en AZ):" $ec_and_amc_no_az
Write-Host "7. Solo en AMC:" $amc_only

Write-Host "`n--- EXPLICACION MATEMATICA DE LOS NUMEROS 1535 vs 3950 ---"
Write-Host "Numero 1,535:" $ec_only "(Predios que se quedaron SOLOS en Fase 1 y jamas cruzaron a AZ)"
Write-Host "Numero 3,950 = ($ec_and_az que cruzaron de EC a AZ) + ($az_only que entraron directo a AZ) =" ($ec_and_az + $az_only)
Write-Host "`n--- ANALISIS DE LOS 884 PREDIOS DIRECTOS EN AZ (Sin EC previa) ---"
$az_only_list = @($data | Where-Object { $_.in_ec -ne $true -and $_.in_az -eq $true })
Write-Host "Total directo AZ:" $az_only_list.Count
$az_only_list | Group-Object tipo_licencia | Select-Object Name, Count | Format-Table -AutoSize
$az_only_list | Group-Object year | Select-Object Name, Count | Format-Table -AutoSize
Write-Host "`n--- ESTADOS DETALLADOS DE LOS 3,950 EN GESTION AZ ---"
$fase2 = @($data | Where-Object { $_.fase -eq 2 })
Write-Host "Total en Fase 2:" $fase2.Count

Write-Host "`nPor Estado de Tramite:"
$fase2 | Group-Object estado_tramite | Select-Object Name, Count | Format-Table -AutoSize

Write-Host "`nPor Emision de Licencia:"
$con_emision = @($fase2 | Where-Object { $_.fecha_emision_az -ne $null -and $_.fecha_emision_az -ne "" }).Count
$sin_emision = @($fase2 | Where-Object { $_.fecha_emision_az -eq $null -or $_.fecha_emision_az -eq "" }).Count
Write-Host "Licencia LMU ya emitida por la Zonal (pero sin Certificado AMC):" $con_emision
Write-Host "En tramite en la Zonal (sin fecha emision):" $sin_emision

Write-Host "`nMuestra de 5 predios en Fase 2:"
$fase2 | Select-Object -First 5 | Select-Object predio, tipo_licencia, year, ad_zonal, estado_tramite, fecha_inicio_az, fecha_emision_az | Format-Table -AutoSize
Write-Host "=================================================================="
