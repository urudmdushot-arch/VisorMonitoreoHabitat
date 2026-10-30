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

$o = [char]0x00F3
$a = [char]0x00E1
$zonalDict = @{
    "AZCHA" = @{ Name = "Choc${o} Andino"; Full = "Administraci${o}n Zonal Choc${o} Andino"; Alias = "Administraci${o}n Zonal Choc${o} Andino"; Centroid = @(-78.680, 0.080); Color = "#10b981" }
    "AZEE"  = @{ Name = "Eugenio Espejo"; Full = "Administraci${o}n Zonal Eugenio Espejo"; Alias = "Administraci${o}n Zonal Eugenio Espejo"; Centroid = @(-78.475, -0.165); Color = "#0284c7" }
    "AZCH"  = @{ Name = "Los Chillos"; Full = "Administraci${o}n Zonal Los Chillos"; Alias = "Administraci${o}n Zonal Los Chillos"; Centroid = @(-78.460, -0.280); Color = "#f59e0b" }
    "AZQ"   = @{ Name = "Quitumbe"; Full = "Administraci${o}n Zonal Quitumbe"; Alias = "Administraci${o}n Zonal Quitumbe"; Centroid = @(-78.552, -0.312); Color = "#8b5cf6" }
    "AZCA"  = @{ Name = "Calder${o}n"; Full = "Administraci${o}n Zonal Calder${o}n"; Alias = "Administraci${o}n Zonal Calder${o}n"; Centroid = @(-78.435, -0.098); Color = "#ec4899" }
    "AZMS"  = @{ Name = "Manuela S${a}enz"; Full = "Administraci${o}n Zonal Manuela S${a}enz"; Alias = "Administraci${o}n Zonal Centro"; Centroid = @(-78.508, -0.220); Color = "#eab308" }
    "AZT"   = @{ Name = "Tumbaco"; Full = "Administraci${o}n Zonal Tumbaco"; Alias = "Administraci${o}n Zonal Tumbaco"; Centroid = @(-78.390, -0.205); Color = "#06b6d4" }
    "AZLM"  = @{ Name = "La Mariscal"; Full = "Administraci${o}n Zonal La Mariscal"; Alias = "Administraci${o}n Zonal La Mariscal"; Centroid = @(-78.492, -0.202); Color = "#14b8a6" }
    "AZLD"  = @{ Name = "La Delicia"; Full = "Administraci${o}n Zonal La Delicia"; Alias = "Administraci${o}n Zonal La Delicia"; Centroid = @(-78.495, -0.115); Color = "#6366f1" }
    "AZEA"  = @{ Name = "Eloy Alfaro"; Full = "Administraci${o}n Zonal Eloy Alfaro"; Alias = "Administraci${o}n Zonal Eloy Alfaro"; Centroid = @(-78.530, -0.258); Color = "#f97316" }
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
    
    $parts = New-Object int[] $numParts
    for ($p = 0; $p -lt $numParts; $p++) {
        $parts[$p] = $br.ReadInt32()
    }
    
    $allX = New-Object double[] $numPoints
    $allY = New-Object double[] $numPoints
    for ($i = 0; $i -lt $numPoints; $i++) {
        $allX[$i] = [Math]::Round($br.ReadDouble(), 6)
        $allY[$i] = [Math]::Round($br.ReadDouble(), 6)
    }
    
    # Process parts/rings using strongly typed List of double[]
    $rings = New-Object System.Collections.Generic.List[System.Collections.Generic.List[double[]]]
    for ($p = 0; $p -lt $numParts; $p++) {
        $startIdx = $parts[$p]
        $endIdx = if ($p -lt ($numParts - 1)) { $parts[$p + 1] - 1 } else { $numPoints - 1 }
        
        $ringPts = New-Object System.Collections.Generic.List[double[]]
        $prevX = [double]::NaN
        $prevY = [double]::NaN
        
        for ($i = $startIdx; $i -le $endIdx; $i++) {
            $x = $allX[$i]
            $y = $allY[$i]
            if ([double]::IsNaN($prevX)) {
                $ringPts.Add([double[]]@($x, $y))
                $prevX = $x
                $prevY = $y
            } else {
                $dx = $x - $prevX
                $dy = $y - $prevY
                if (($dx * $dx + $dy * $dy) -ge $minDistSq -or $i -eq $endIdx) {
                    $ringPts.Add([double[]]@($x, $y))
                    $prevX = $x
                    $prevY = $y
                }
            }
        }
        
        # Ensure closed ring
        if ($ringPts.Count -gt 2) {
            $first = $ringPts[0]
            $last = $ringPts[$ringPts.Count - 1]
            if ($first[0] -ne $last[0] -or $first[1] -ne $last[1]) {
                $ringPts.Add([double[]]@($first[0], $first[1]))
            }
            $rings.Add($ringPts)
        }
    }
    
    # Classify exterior vs hole rings
    $polyList = New-Object System.Collections.Generic.List[System.Collections.Generic.List[System.Collections.Generic.List[double[]]]]
    $currentPoly = New-Object System.Collections.Generic.List[System.Collections.Generic.List[double[]]]
    
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
                $polyList.Add($currentPoly)
            }
            $currentPoly = New-Object System.Collections.Generic.List[System.Collections.Generic.List[double[]]]
            $currentPoly.Add($r)
        } else {
            if ($currentPoly.Count -eq 0) {
                $currentPoly.Add($r)
            } else {
                $currentPoly.Add($r)
            }
        }
    }
    if ($currentPoly.Count -gt 0) {
        $polyList.Add($currentPoly)
    }
    
    # Build coordinates array
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
    $zFull = if ($info) { $info.Full } else { "Administraci${o}n Zonal $zName" }
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

# Output to JSON with depth 15
$jsonText = $geojson | ConvertTo-Json -Depth 15 -Compress

# Save GeoJSON with UTF-8 encoding
[System.IO.File]::WriteAllText("public/data/administraciones_zonales.geojson", $jsonText, [System.Text.Encoding]::UTF8)

# Save JS bundle
$jsContent = "window.ZONAS_DATA = $jsonText;"
[System.IO.File]::WriteAllText("public/data/zonas_data.js", $jsContent, [System.Text.Encoding]::UTF8)

Write-Output "Successfully updated GeoJSON and JS bundle!"

# VALIDATION TEST
$testJson = [System.IO.File]::ReadAllText("public/data/zonas_data.js")
if ($testJson -match "\{\}") {
    Write-Error "VALIDATION FAILED: Found empty object {} in coordinates!"
} else {
    Write-Output "VALIDATION PASSED: No empty objects {} found."
}
if ($testJson -match ",\[-?[0-9\.]+,\[") {
    Write-Error "VALIDATION FAILED: Found unnested coordinates!"
} else {
    Write-Output "VALIDATION PASSED: Coordinates structure is valid."
}
