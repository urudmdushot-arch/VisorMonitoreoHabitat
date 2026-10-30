$ErrorActionPreference = "Stop"

$shpPath = "202508_Limites_Administraciones_Zonales/organizacion_territorial_zonal_a.shp"
$dbfPath = "202508_Limites_Administraciones_Zonales/organizacion_territorial_zonal_a.dbf"

# 1. Parse DBF
$dbfBytes = [System.IO.File]::ReadAllBytes($dbfPath)
$numRecords = [System.BitConverter]::ToUInt32($dbfBytes, 4)
$headerLen = [System.BitConverter]::ToUInt16($dbfBytes, 8)
$recordLen = [System.BitConverter]::ToUInt16($dbfBytes, 10)

$fields = @()
$offset = 32
while ($offset -lt ($headerLen - 1) -and $dbfBytes[$offset] -ne 13) {
    $fieldName = [System.Text.Encoding]::ASCII.GetString($dbfBytes, $offset, 11).Trim("`0").Trim()
    $fieldType = [char]$dbfBytes[$offset + 11]
    $fieldLength = $dbfBytes[$offset + 16]
    $fields += [PSCustomObject]@{
        Name = $fieldName
        Type = $fieldType
        Length = $fieldLength
    }
    $offset += 32
}

$dbfRows = @()
for ($i = 0; $i -lt $numRecords; $i++) {
    $recOffset = $headerLen + ($i * $recordLen)
    $row = [ordered]@{}
    $fOffset = $recOffset + 1 # skip deletion flag
    foreach ($f in $fields) {
        $valRaw = [System.Text.Encoding]::ASCII.GetString($dbfBytes, $fOffset, $f.Length).Trim()
        $row[$f.Name] = $valRaw
        $fOffset += $f.Length
    }
    $dbfRows += $row
}

$zonalDict = @{
    "AZCHA" = @{ Name = "Chocó Andino"; Full = "Administración Zonal Chocó Andino"; Alias = "Administración Zonal Chocó Andino"; Centroid = @(-78.68, 0.08); Color = "#10b981" }
    "AZEE"  = @{ Name = "Eugenio Espejo"; Full = "Administración Zonal Eugenio Espejo"; Alias = "Administración Zonal Eugenio Espejo"; Centroid = @(-78.44, -0.12); Color = "#0284c7" }
    "AZCH"  = @{ Name = "Los Chillos"; Full = "Administración Zonal Los Chillos"; Alias = "Administración Zonal Los Chillos"; Centroid = @(-78.43, -0.32); Color = "#f59e0b" }
    "AZQ"   = @{ Name = "Quitumbe"; Full = "Administración Zonal Quitumbe"; Alias = "Administración Zonal Quitumbe"; Centroid = @(-78.55, -0.34); Color = "#8b5cf6" }
    "AZCA"  = @{ Name = "Calderón"; Full = "Administración Zonal Calderón"; Alias = "Administración Zonal Calderón"; Centroid = @(-78.40, -0.05); Color = "#ec4899" }
    "AZMS"  = @{ Name = "Manuela Sáenz"; Full = "Administración Zonal Manuela Sáenz"; Alias = "Administración Zonal Centro"; Centroid = @(-78.51, -0.22); Color = "#eab308" }
    "AZT"   = @{ Name = "Tumbaco"; Full = "Administración Zonal Tumbaco"; Alias = "Administración Zonal Tumbaco"; Centroid = @(-78.33, -0.22); Color = "#06b6d4" }
    "AZLM"  = @{ Name = "La Mariscal"; Full = "Administración Zonal La Mariscal"; Alias = "Administración Zonal La Mariscal"; Centroid = @(-78.49, -0.203); Color = "#14b8a6" }
    "AZLD"  = @{ Name = "La Delicia"; Full = "Administración Zonal La Delicia"; Alias = "Administración Zonal La Delicia"; Centroid = @(-78.52, -0.04); Color = "#6366f1" }
    "AZEA"  = @{ Name = "Eloy Alfaro"; Full = "Administración Zonal Eloy Alfaro"; Alias = "Administración Zonal Eloy Alfaro"; Centroid = @(-78.55, -0.26); Color = "#f97316" }
}

# 2. Parse SHP
$fs = [System.IO.File]::OpenRead($shpPath)
$br = New-Object System.IO.BinaryReader($fs)
$br.BaseStream.Seek(100, [System.IO.SeekOrigin]::Begin) | Out-Null

$minDistSq = 0.00008 * 0.00008 # ~9 meters tolerance
$features = @()

for ($recIdx = 0; $recIdx -lt $numRecords; $recIdx++) {
    if ($br.BaseStream.Position -ge $br.BaseStream.Length) { break }
    
    $recNum = [System.Net.IPAddress]::NetworkToHostOrder($br.ReadInt32())
    $contentLen = [System.Net.IPAddress]::NetworkToHostOrder($br.ReadInt32()) * 2
    $contentStart = $br.BaseStream.Position
    
    $shapeType = $br.ReadInt32()
    if ($shapeType -ne 5) {
        $br.BaseStream.Seek($contentStart + $contentLen, [System.IO.SeekOrigin]::Begin) | Out-Null
        continue
    }
    
    $xmin = $br.ReadDouble()
    $ymin = $br.ReadDouble()
    $xmax = $br.ReadDouble()
    $ymax = $br.ReadDouble()
    
    $numParts = $br.ReadInt32()
    $numPoints = $br.ReadInt32()
    $parts = 0..($numParts - 1) | ForEach-Object { $br.ReadInt32() }
    
    $rawPoints = 0..($numPoints - 1) | ForEach-Object {
        [PSCustomObject]@{
            X = [Math]::Round($br.ReadDouble(), 6)
            Y = [Math]::Round($br.ReadDouble(), 6)
        }
    }
    
    # Process parts/rings
    $rings = @()
    for ($p = 0; $p -lt $numParts; $p++) {
        $startIdx = $parts[$p]
        $endIdx = if ($p -lt ($numParts - 1)) { $parts[$p + 1] - 1 } else { $numPoints - 1 }
        
        $ringPts = @()
        $prevX = [double]::NaN
        $prevY = [double]::NaN
        
        for ($i = $startIdx; $i -le $endIdx; $i++) {
            $pt = $rawPoints[$i]
            if ([double]::IsNaN($prevX)) {
                $ringPts += @($pt.X, $pt.Y)
                $prevX = $pt.X
                $prevY = $pt.Y
            } else {
                $dx = $pt.X - $prevX
                $dy = $pt.Y - $prevY
                if (($dx * $dx + $dy * $dy) -ge $minDistSq -or $i -eq $endIdx) {
                    $ringPts += ,@($pt.X, $pt.Y)
                    $prevX = $pt.X
                    $prevY = $pt.Y
                }
            }
        }
        
        # Ensure closed ring
        if ($ringPts.Count -gt 2) {
            $first = $ringPts[0]
            $last = $ringPts[$ringPts.Count - 1]
            if ($first[0] -ne $last[0] -or $first[1] -ne $last[1]) {
                $ringPts += ,@($first[0], $first[1])
            }
            $rings += ,$ringPts
        }
    }
    
    $polyList = @()
    $currentPoly = @()
    
    foreach ($r in $rings) {
        $area = 0.0
        for ($i = 0; $i -lt ($r.Count - 1); $i++) {
            $pA = $r[$i]
            $pB = $r[$i + 1]
            $area += ($pB[0] - $pA[0]) * ($pB[1] + $pA[1])
        }
        $isCW = $area -gt 0.0
        
        if ($isCW) {
            if ($currentPoly.Count -gt 0) {
                $polyList += ,$currentPoly
            }
            $currentPoly = @(,$r)
        } else {
            if ($currentPoly.Count -eq 0) {
                $currentPoly = @(,$r)
            } else {
                $currentPoly += ,$r
            }
        }
    }
    if ($currentPoly.Count -gt 0) {
        $polyList += ,$currentPoly
    }
    
    $geom = if ($polyList.Count -eq 1) {
        [ordered]@{
            type = "Polygon"
            coordinates = $polyList[0]
        }
    } else {
        [ordered]@{
            type = "MultiPolygon"
            coordinates = $polyList
        }
    }
    
    $dbfData = $dbfRows[$recIdx]
    $codZonal = $dbfData["cod_adm_zo"]
    $info = $zonalDict[$codZonal]
    $zName = if ($info) { $info.Name } else { $dbfData["adm_zonal"] }
    $zFull = if ($info) { $info.Full } else { "Administración Zonal $zName" }
    $zAlias = if ($info) { $info.Alias } else { $zFull }
    $zCent = if ($info) { $info.Centroid } else { @([Math]::Round(($xmin + $xmax) / 2.0, 6), [Math]::Round(($ymin + $ymax) / 2.0, 6)) }
    $zColor = if ($info) { $info.Color } else { "#38bdf8" }
    
    $areaKm2 = if ($dbfData["Shape_Area"]) { [Math]::Round([double]$dbfData["Shape_Area"] / 1000000.0, 2) } else { 0 }
    $perimKm = if ($dbfData["Shape_Leng"]) { [Math]::Round([double]$dbfData["Shape_Leng"] / 1000.0, 2) } else { 0 }
    
    $feature = [ordered]@{
        type = "Feature"
        id = $codZonal
        properties = [ordered]@{
            cod_adm_zo = $codZonal
            adm_zonal = $zName
            nombre_completo = $zFull
            alias = $zAlias
            area_km2 = $areaKm2
            perimetro_km = $perimKm
            color = $zColor
            centroid = $zCent
            bbox = @([Math]::Round($xmin, 6), [Math]::Round($ymin, 6), [Math]::Round($xmax, 6), [Math]::Round($ymax, 6))
        }
        geometry = $geom
    }
    
    $features += $feature
    
    $br.BaseStream.Seek($contentStart + $contentLen, [System.IO.SeekOrigin]::Begin) | Out-Null
}

$br.Close()
$fs.Close()

$geojson = [ordered]@{
    type = "FeatureCollection"
    features = $features
}

# Output to JSON
$jsonText = $geojson | ConvertTo-Json -Depth 10 -Compress

# Save GeoJSON with UTF-8 encoding
[System.IO.File]::WriteAllText("public/data/administraciones_zonales.geojson", $jsonText, [System.Text.Encoding]::UTF8)

# Save JS bundle
$jsContent = "window.ZONAS_DATA = $jsonText;"
[System.IO.File]::WriteAllText("public/data/zonas_data.js", $jsContent, [System.Text.Encoding]::UTF8)

Write-Output "Successfully updated GeoJSON and JS bundle with canonical names and centroids!"
foreach ($f in $features) {
    Write-Output " - $($f.id): $($f.properties.nombre_completo) | Centroid: $($f.properties.centroid -join ', ')"
}
