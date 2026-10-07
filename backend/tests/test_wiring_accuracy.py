from backend.services.wiring_accuracy import accuracy_report, electrical_issues
from backend.services.wiring_review import review_schematic


def part(component_id, voltage):
    return {
        'id': component_id,
        'sourceFile': f'{component_id}.step',
        'dimensions': [10, 20, 30],
        'partIdentity': {'manufacturer':'Acme','partNumber':component_id,'revision':'A'},
        'connectors': [{'id':'J1','cavities':[{'number':'1'}]}],
        'pins': [{'id':'1','position3d':[0,0,0],'verification':'verified','voltage':voltage,'connectorFamily':'JST-XH'}],
    }


def test_verified_build_reports_physical_readiness():
    component = part('board', {'min':4.8,'max':5.2})
    schematic = {'buildMode':'verified','components':[component], 'wires':[]}
    report = accuracy_report(schematic)
    assert report['readyForPhysicalWiring'] is True
    assert report['exactGeometryPercent'] == 100


def test_verified_build_blocks_missing_identity_and_anchors():
    result = review_schematic({'buildMode':'verified','components':[{'id':'board','type':'sensor'}],'wires':[]})
    assert result['blocker']['blocked'] is True
    assert 'manufacturer, part number, and revision' in ' '.join(result['blocker']['issues'])
    assert result['accuracyReport']['readyForPhysicalWiring'] is False


def test_drc_rejects_voltage_and_connector_mismatch():
    source = part('source', {'min':24,'max':24})
    load = part('load', {'min':4.8,'max':5.2})
    load['pins'][0]['connectorFamily'] = 'Molex-MicroFit'
    issues = electrical_issues({'components':[source,load], 'wires':[{'id':'w1','from':{'componentId':'source','pinId':'1'},'to':{'componentId':'load','pinId':'1'}}]})
    assert {issue['code'] for issue in issues} == {'voltage-range','connector-family'}


def test_drc_rejects_declared_wire_overload():
    one = part('one', {'min':5,'max':5}); two = part('two', {'min':5,'max':5})
    issues = electrical_issues({'components':[one,two], 'wires':[{'id':'w1','maxCurrentA':1,'loadCurrentA':2,'from':{'componentId':'one','pinId':'1'},'to':{'componentId':'two','pinId':'1'}}]})
    assert [issue['code'] for issue in issues] == ['wire-ampacity']


def test_drc_calculates_round_trip_voltage_drop():
    one = part('one', {'min':5,'max':5}); two = part('two', {'min':5,'max':5})
    wire = {'id':'w1','awg':28,'cutLengthMm':2000,'loadCurrentA':2,'maxVoltageDropV':.5,'from':{'componentId':'one','pinId':'1'},'to':{'componentId':'two','pinId':'1'}}
    issues = electrical_issues({'components':[one,two], 'wires':[wire]})
    assert [issue['code'] for issue in issues] == ['voltage-drop']
    assert issues[0]['calculatedVoltageDropV'] == 1.7032
