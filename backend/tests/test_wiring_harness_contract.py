from backend.services import wiring_harness_contract as h

def test_signal_edit_keeps_cad_and_route_but_changed_endpoint_drops_old_route():
    a={'id':'a','type':'sensor','pins':[{'id':'out','position3d':[1,2,3]}],'sourceFile':'board.step'}
    b={'id':'b','type':'sensor'}
    wire={'id':'w','from':{'componentId':'a','pinId':'out'},'to':{'componentId':'b','pinId':'in'},'route3d':{'points':[[1,2,3]]},'minBendRadiusMm':5}
    current={'components':[a,b],'wires':[wire]}
    new={'components':[{'id':'a','type':'sensor'},dict(b)],'wires':[{k:wire[k] for k in ('id','from','to')}]}
    h.preserve(current,new)
    assert new['components'][0]['sourceFile']=='board.step' and new['wires'][0]['minBendRadiusMm']==5
    new['wires'][0]['route3d']['points'][0][0]=9
    assert wire['route3d']['points'][0][0]==1
    changed={'components':[dict(a),dict(b)],'wires':[{'id':'w','from':wire['from'],'to':{'componentId':'b','pinId':'other'}}]}
    h.preserve(current,changed)
    assert 'route3d' not in changed['wires'][0]
